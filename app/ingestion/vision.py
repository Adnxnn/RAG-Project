import base64
from openai import OpenAI
from app.core.config import settings

def describe_image(data: bytes, context: str) -> str:
    if not settings.openai_api_key:
        return f"Visual content ({context}). Configure OPENAI_API_KEY for chart, diagram, image and OCR understanding."
    client=OpenAI(api_key=settings.openai_api_key)
    encoded=base64.b64encode(data).decode()
    r=client.chat.completions.create(model=settings.openai_vision_model,messages=[{"role":"user","content":[{"type":"text","text":"Extract all visible text and describe this image, table, chart or diagram precisely. Preserve labels, values and relationships. Context: "+context},{"type":"image_url","image_url":{"url":"data:image/png;base64,"+encoded}}]}],temperature=0)
    return r.choices[0].message.content or ""
