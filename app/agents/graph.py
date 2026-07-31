from typing import TypedDict

from langgraph.graph import END, StateGraph
from openai import OpenAI

from app.core.config import settings
from app.core.models import SourceRef
from app.retrieval.hybrid import retriever


class State(TypedDict, total=False):
    question: str
    query: str
    conversation_id: str
    route: str
    contexts: list
    answer: str
    citations: list
    retries: int
    relevant: bool


def route(state: State):
    question = state["question"].lower()
    state["route"] = "sql" if any(term in question for term in ["sql", "database", "table schema"]) else "knowledge"
    state["query"] = state["question"]
    state["retries"] = 0
    return state


def retrieve(state: State):
    state["contexts"] = retriever.search(
        state["query"], conversation_id=state["conversation_id"]
    )
    return state


def validate(state: State):
    state["relevant"] = bool(state["contexts"]) and any(
        word in " ".join(block.text.lower() for block in state["contexts"])
        for word in state["question"].lower().split()
        if len(word) > 3
    )
    return state


def rewrite(state: State):
    state["query"] = (
        "Corporate knowledge question: "
        + state["question"]
        + " Include exact names, numbers, tables, charts and policy terminology."
    )
    state["retries"] += 1
    return state


def generate(state: State):
    context = "\n\n".join(
        f"[{index + 1}] {block.text}" for index, block in enumerate(state["contexts"])
    )
    if not context:
        state["answer"] = "I could not find relevant information in the sources attached to this chat."
    elif settings.openai_api_key:
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model=settings.openai_chat_model,
            temperature=0,
            messages=[
                {
                    "role": "system",
                    "content": "Answer only from supplied evidence. Cite claims using [1], [2]. Say when evidence is insufficient.",
                },
                {
                    "role": "user",
                    "content": f"Question: {state['question']}\nEvidence:\n{context}",
                },
            ],
        )
        state["answer"] = response.choices[0].message.content or ""
    else:
        state["answer"] = "OPENAI_API_KEY is not configured. Retrieved evidence:\n\n" + context[:5000]

    state["citations"] = [
        SourceRef(
            source_id=block.source_id,
            file_name=block.metadata.get("file_name", "source"),
            locator=block.metadata.get("locator", ""),
            url=block.metadata.get("url"),
        )
        for block in state["contexts"]
    ]
    return state


def decide(state: State):
    return "generate" if state["relevant"] or state["retries"] >= settings.max_corrective_retries else "rewrite"


graph = StateGraph(State)
graph.add_node("route", route)
graph.add_node("retrieve", retrieve)
graph.add_node("validate", validate)
graph.add_node("rewrite", rewrite)
graph.add_node("generate", generate)
graph.set_entry_point("route")
graph.add_edge("route", "retrieve")
graph.add_edge("retrieve", "validate")
graph.add_conditional_edges("validate", decide, {"generate": "generate", "rewrite": "rewrite"})
graph.add_edge("rewrite", "retrieve")
graph.add_edge("generate", END)
agent_graph = graph.compile()
