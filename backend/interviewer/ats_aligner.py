import json
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import RunnableLambda
from django.conf import settings
from .ats_service import get_ats_llm, CorrectedResumeSchema, generate_resume_pdf, safe_chain_invoke

def align_resume(resume_text: str, target_jd: str, username: str = "Candidate") -> bytes:
    model = get_ats_llm()
    parser = PydanticOutputParser(pydantic_object=CorrectedResumeSchema)
    
    prompt = f"""
    You are an Expert Resume Editor.
    Your task is to take a candidate's original resume text, analyze it against the target job description (JD), and rewrite it to align with the role.
    
    ORIGINAL RESUME TEXT:
    -------------------
    {resume_text}
    -------------------
    
    TARGET JOB DESCRIPTION:
    -------------------
    {target_jd}
    -------------------
    
    CRITICAL ALIGNMENT INSTRUCTIONS:
    1. DO NOT invent, hallucinate, or fabricate any jobs, degrees, certifications, skills, dates, or projects. You must only use the factual information present in the original resume.
    2. CORRECT all spelling mistakes, typos, and grammatical errors.
    3. REWRITE weak or passive phrases using high-impact action verbs (e.g. "Developed scalable backend services", "Spearheaded collaborative projects").
    4. MATCH key vocabulary and terms from the target job description, placing critical technologies and tools first in the lists.
    5. REMOVE overused buzzwords/clichés and replace them with achievements or skills.
    6. STRUCTURE the data strictly into the provided JSON schema. Ensure the name, contact details, summary, and sections are complete.
    
    Return ONLY the json schema matching the Pydantic schema and strictly no extra text.
    {parser.get_format_instructions()}
    """
    
    fallback = CorrectedResumeSchema(
        name=username,
        contact=[],
        summary="Resume alignment failed to generate properly.",
        sections=[]
    )
    
    corrected_data = safe_chain_invoke(model, parser, prompt, fallback_factory=lambda: fallback)
    
    # Generate PDF bytes using standard layout
    pdf_bytes = generate_resume_pdf(corrected_data, font_name="Helvetica")
    return pdf_bytes
