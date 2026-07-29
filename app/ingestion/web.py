from urllib.parse import urlparse
import httpx, trafilatura
from bs4 import BeautifulSoup
from app.core.config import settings
from app.core.models import KnowledgeBlock
from app.ingestion.loaders import _id

async def load_url(url: str) -> list[KnowledgeBlock]:
    host=urlparse(url).hostname or ""
    allowed=[d.strip() for d in settings.web_allowed_domains.split(",") if d.strip()]
    if allowed and not any(host==d or host.endswith("."+d) for d in allowed): raise ValueError("Domain is not allow-listed")
    if host in {"localhost","127.0.0.1","0.0.0.0"}: raise ValueError("Private/local URLs are blocked")
    async with httpx.AsyncClient(follow_redirects=True,timeout=30) as c:
        r=await c.get(url,headers={"User-Agent":"Corporate-RAG/1.0"}); r.raise_for_status()
    ctype=r.headers.get("content-type","")
    text=trafilatura.extract(r.text,include_tables=True,include_links=True) if "html" in ctype else r.text
    if not text: text=BeautifulSoup(r.text,"html.parser").get_text("\n",strip=True)
    sid=_id(url)
    return [KnowledgeBlock(id=_id(sid+"web"),source_id=sid,kind="web",text=text,metadata={"file_name":url,"url":url,"locator":"web page"})]
