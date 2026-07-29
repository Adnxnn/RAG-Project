import requests, streamlit as st
st.set_page_config(page_title="Corporate Multimodal RAG",layout="wide")
st.title("Corporate Multimodal Knowledge Agent")
st.caption("Upload PDFs, Excel, CSV, Word, images, code, or paste reference links. Answers retain page/sheet/table/image provenance.")
api=st.sidebar.text_input("API URL","http://api:8000")
files=st.file_uploader("Upload knowledge files",accept_multiple_files=True)
if st.button("Ingest files",disabled=not files):
    r=requests.post(api+"/ingest/files",files=[("files",(f.name,f.getvalue(),f.type)) for f in files]); st.json(r.json())
url=st.text_input("Reference link (web page, direct document, or image URL)")
if st.button("Read link",disabled=not url): st.json(requests.post(api+"/ingest/url",params={"url":url}).json())
q=st.chat_input("Ask across your corporate knowledge")
if q:
    with st.chat_message("user"): st.write(q)
    with st.chat_message("assistant"):
        data=requests.post(api+"/chat",json={"question":q,"urls":[]}).json(); st.write(data["answer"])
        with st.expander("Sources"):
            for c in data.get("citations",[]): st.write(f"- {c['file_name']} — {c['locator']}")
