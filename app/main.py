from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from app.core.models import QueryRequest, AnswerResponse
from app.ingestion.loaders import load_file
from app.ingestion.web import load_url
from app.retrieval.hybrid import retriever
from app.agents.graph import agent_graph

app=FastAPI(title="Corporate Multimodal RAG",version="0.1.0")
UPLOADS=Path("data/uploads"); UPLOADS.mkdir(parents=True,exist_ok=True)

@app.get("/health")
def health(): return {"status":"ok","indexed_blocks":len(retriever.blocks)}

@app.post("/ingest/files")
async def ingest_files(files:list[UploadFile]=File(...)):
    total=0; details=[]
    for f in files:
        path=UPLOADS/Path(f.filename or "upload").name; path.write_bytes(await f.read())
        blocks=load_file(path); retriever.add(blocks); total+=len(blocks); details.append({"file":path.name,"blocks":len(blocks)})
    return {"ingested_blocks":total,"files":details}

@app.post("/ingest/url")
async def ingest_url(url:str):
    try: blocks=await load_url(url); retriever.add(blocks); return {"url":url,"blocks":len(blocks)}
    except Exception as e: raise HTTPException(400,str(e))

@app.post("/chat",response_model=AnswerResponse)
async def chat(req:QueryRequest):
    for url in req.urls:
        retriever.add(await load_url(url))
    result=agent_graph.invoke({"question":req.question})
    return AnswerResponse(answer=result["answer"],citations=result["citations"],route=result["route"],retries=result["retries"])
