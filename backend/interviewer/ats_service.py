"""
ATS Scoring Service
Extracted from Jupyter notebook — logic unchanged.
"""
import os
import re
from typing import TypedDict, Optional, List
from pydantic import BaseModel, Field
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import RunnableLambda
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END, START
from django.conf import settings
from langchain_groq import ChatGroq

def clean_llm_output(message):
    text = message.content if hasattr(message, "content") else str(message)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    json_block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if json_block:
        return json_block.group(1)
    start = text.find("{")
    end   = text.rfind("}")
    if start != -1 and end != -1:
        return text[start:end + 1]
    return text

cleaner = RunnableLambda(clean_llm_output)

def sanitize_score(val) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        score = float(val)
    else:
        try:
            s = str(val).strip()
            s = s.replace("%", "")
            score = float(s)
        except ValueError:
            score = 0.0
    
    # Scale decimal ratios (e.g. 0.85 -> 85.0)
    if 0.0 < score <= 1.0:
        score *= 100.0
        
    return min(100.0, max(0.0, score))


def safe_chain_invoke(llm, parser, prompt, fallback_factory):
    """
    Invokes the LLM and runs it through the cleaner and parser.
    If the primary LLM fails, iterates through fallback models.
    If the parser fails, tries standard JSON parsing and mapping.
    If everything fails, returns a fallback object populated by fallback_factory.
    """
    raw_text = None
    try:
        chain_raw = llm | cleaner
        raw_text = chain_raw.invoke(prompt)
    except Exception as e:
        print(f"[SafeInvoke-ATS] Primary LLM invocation failed: {e}")
        # Try fallback Groq models
        api_key = getattr(settings, "GROQ_API_KEY", None) or os.getenv("GROQ_API_KEY")
        fallback_models = ["openai/gpt-oss-20b", "groq/compound", "openai/gpt-oss-120b"]
        for fb_model in fallback_models:
            try:
                print(f"[SafeInvoke-ATS] Attempting fallback model: {fb_model}")
                fb_llm = ChatGroq(model=fb_model, api_key=api_key, temperature=0.1)
                fb_chain = fb_llm | cleaner
                raw_text = fb_chain.invoke(prompt)
                print(f"[SafeInvoke-ATS] Fallback model {fb_model} succeeded")
                break
            except Exception as fb_err:
                print(f"[SafeInvoke-ATS] Fallback model {fb_model} failed: {fb_err}")
                
    if not raw_text:
        print("[SafeInvoke-ATS] All LLM invocation attempts failed, returning fallback object.")
        return fallback_factory()

    # 2. Try parsing with Pydantic parser
    result = None
    try:
        result = parser.parse(raw_text)
    except Exception as parse_err:
        print(f"[SafeInvoke-ATS] Pydantic parser failed, attempting manual JSON parse: {parse_err}")
        
    # 3. Try standard JSON parsing if Pydantic parse failed
    if result is None:
        try:
            import json
            clean_text = clean_llm_output(raw_text)
            data = json.loads(clean_text)
            pydantic_class = parser.pydantic_object
            
            # Normalize schema if LLM returned section fragment or array
            if pydantic_class == CorrectedResumeSchema:
                if isinstance(data, list):
                    data = {"sections": data}
                elif isinstance(data, dict) and "sections" not in data:
                    if "items" in data or "title" in data:
                        data = {"sections": [data]}

            # Build kwargs, falling back to defaults if missing or incorrect type
            kwargs = {}
            for name, field in pydantic_class.model_fields.items():
                # In case LLM used 'education_score' instead of 'qualification_score'
                if name == "qualification_score" and "education_score" in data and "qualification_score" not in data:
                    data["qualification_score"] = data["education_score"]
                    
                default = field.default if not field.is_required() else None
                if default is None or default == ...:
                    default = 0.0 if field.annotation in (float, int) else ""
                    
                val = data.get(name, default)
                if val is None:
                    val = default
                    
                if field.annotation == float:
                    val = sanitize_score(val)
                elif field.annotation == bool:
                    val = str(val).lower() in ("true", "1", "yes", "t")
                    
                kwargs[name] = val
                
            result = pydantic_class(**kwargs)
        except Exception as fallback_err:
            print(f"[SafeInvoke-ATS] Manual parsing failed: {fallback_err}")
            result = fallback_factory()

    # Post-parse sanitization of float fields to ensure 0-100 scaling
    if result and hasattr(result, "model_fields"):
        for name, field in result.model_fields.items():
            if field.annotation == float:
                orig_val = getattr(result, name, None)
                if orig_val is not None:
                    setattr(result, name, sanitize_score(orig_val))
                    
    return result

# ── LLM ──────────────────────────────────────────────────────
_ats_llm = None

def get_ats_llm():
    global _ats_llm
    if _ats_llm is None:
        api_key = getattr(settings, "GROQ_API_KEY", None) or os.getenv("GROQ_API_KEY")
        _ats_llm = ChatGroq(
            model="qwen/qwen3.6-27b",
            api_key=api_key,
            temperature=0.1
        )
    return _ats_llm


# ── Schemas ───────────────────────────────────────────────────
class get_ats_schema(BaseModel):
    skill_score: float = Field(default=0.0, description="calculate skill_score")
    experience_score: float = Field(default=0.0, description="calculate experience_score")
    qualification_score: float = Field(default=0.0, description="calculate qualification_score")
    achievement_score: float = Field(default=0.0, description="calculate achievement_score")
    technology_and_tools_score: float = Field(default=0.0, description="calculate the technology_and_tools_score")
    internship_score: float = Field(default=0.0, description="calculate internship_score")
    soft_skill_score: float = Field(default=0.0, description="calculate softskill_score")
    has_strong_project: bool = Field(default=False, description="calculate has strong project score")
    feedback_summary: str = Field(default="", description="A 1-2 sentence feedback explaining the strengths and weaknesses found in the resume relative to the JD.")


class get_desc_schema(BaseModel):
    skill: list[str]= Field(default=[], description="skills required for the job")
    qualification: list[str] = Field(default=[], description="Qualification required for the job")
    soft_skill: list[str] = Field(default=[], description="soft_skill required for the job")
    experience_year: str = Field(default="0", description="Year of experience required for the job")
    project_experience: list[str] = Field(default=[], description="project experience required")
    other_info: str = Field(default="", description="Any important other information")
    technology_and_tools: list[str] = Field(default=[], description="All required tools and technology")


class FeedbackIssue(BaseModel):
    issue: str = Field(description="Clear, short description of the mistake/issue")
    severity: str = Field(description="Severity of the issue: high, medium, or low")
    suggestion: str = Field(description="Detailed instruction on how to fix it")
    location: str = Field(description="Section of the resume where it is located (e.g., 'Work Experience', 'Skills', 'Header', or 'General')")
    context: str = Field(description="The exact snippet of text from the resume showing the issue, or blank if formatting/general")


class StudentAtsAuditSchema(BaseModel):
    overall_score: float = Field(description="Weighted overall score out of 100 based on formatting, font, content, grammar, and word choice")
    
    formatting_score: float = Field(description="Score out of 100 for page layout, margins, structure, length, alignment, and section division")
    formatting_feedback: List[FeedbackIssue] = Field(description="Detailed formatting issues found in the resume")
    
    font_score: float = Field(description="Score out of 100 for typography, font choices, size consistency, hierarchy, and professional color usage")
    font_feedback: List[FeedbackIssue] = Field(description="Detailed font and typography issues found in the resume")
    
    content_score: float = Field(description="Score out of 100 for content completeness, section fields, action verbs usage, and quantifiable impact")
    content_feedback: List[FeedbackIssue] = Field(description="Detailed content issues and gaps found in the resume")
    
    grammar_score: float = Field(description="Score out of 100 for spelling, grammar, syntax, correct verb tenses, and punctuation")
    grammar_feedback: List[FeedbackIssue] = Field(description="Detailed grammar and spelling mistakes found in the resume")
    
    word_choice_score: float = Field(description="Score out of 100 for word usage, tone, buzzword density, and correct terminology")
    word_choice_feedback: List[FeedbackIssue] = Field(description="Detailed word choice, tone, buzzword, or phrasing improvements")
    
    strengths: List[str] = Field(description="3-5 key strengths of the resume")
    summary: str = Field(description="A concise summary of the resume's ATS readiness and next steps for improvement")


# ── State ─────────────────────────────────────────────────────
class AtsState(TypedDict):
    desc: str
    resume: str
    skill: list[str]
    qualification: list[str]
    soft_skill: list[str]
    technology_and_tools: list[str]
    experience_year: str
    project_experience: list[str]
    other_info: str
    skill_score: float
    experience_score: float
    qualification_score: float
    achievement_score: float
    technology_and_tools_score: float
    internship_score: float
    soft_skill_score: float
    has_strong_project: bool
    feedback_summary: str


# ── Weights ───────────────────────────────────────────────────
ATS_WEIGHTS = {
    "skill": 0.35,
    "qualification": 0.10,
    "experience": 0.10,
    "achievement": 0.05,
    "internship": 0.05,
    "soft_skill": 0.05,
    "has_strong_project": 0.05,
    "technology_and_tools": 0.25,
}


# ── Node: summarise_desc ──────────────────────────────────────
def summarise_desc(state: AtsState) -> AtsState:
    model = get_ats_llm()
    parser1 = PydanticOutputParser(pydantic_object=get_desc_schema)
    chain1 = model | parser1
    job_desc = state["desc"]
    prompt = f"""
    You are an ATS Job Description Requirement Extractor.
    Analyze the recruiter job description and extract information STRICTLY according to the schema.

    JOB DESCRIPTION:
    ---------------------
    {job_desc}
    ---------------------

    RULES:
    1. Extract ONLY information explicitly mentioned.
    2. Do NOT infer or guess missing information.
    3. Remove duplicates.
    4. Standardize names:
       - RESTful APIs -> REST API
       - JS -> JavaScript
       - NodeJS -> Node.js
       - Postgres -> PostgreSQL
    5. Convert all extracted text to lowercase.
    6. Use [] for missing list fields, "0" for missing experience_year, "" for missing other_info.
    7. Return ONLY the structured output required by the schema.
    8. No markdown, explanation, or extra keys.

    FIELD DEFINITIONS:
    skill: High-level technical competencies.
    technology_and_tools: Specific technologies, frameworks, databases, libraries, cloud platforms.
    qualification: Degrees, educational branches, certifications.
    soft_skill: Behavioral skills.
    experience_year: Extract experience exactly as mentioned.
    project_experience: Specific project or domain experience explicitly required.
    other_info: Important shortlisting info only. No personal details.
   
    imp point:
    Return ONLY the json schema matching the Pydantic schema and strictly no extra explanation or text required.

    {parser1.get_format_instructions()}
    """
    result = safe_chain_invoke(
        model, parser1, prompt,
        fallback_factory=lambda: get_desc_schema(
            skill=[], qualification=[], soft_skill=[], experience_year="0", project_experience=[], other_info="", technology_and_tools=[]
        )
    )
    return {
        "skill": result.skill,
        "qualification": result.qualification,
        "soft_skill": result.soft_skill,
        "technology_and_tools": result.technology_and_tools,
        "experience_year": result.experience_year,
        "project_experience": result.project_experience,
        "other_info": result.other_info,
    }


# ── Node: matching ────────────────────────────────────────────
def matching(state: AtsState) -> AtsState:
    model = get_ats_llm()
    parser = PydanticOutputParser(pydantic_object=get_ats_schema)
    chain = model | parser
    mresume = state["resume"]
    prompt = f"""
    You are an Expert ATS Scoring Engine.
    Compare the Job Description (JD) with the candidate Resume and generate ATS scores and short feedback.

    resume: {mresume}
    
    Job Description context:
    raw_job_description: {state["desc"]}
    
    Extracted job requirements:
    skill: {state["skill"]}
    qualification: {state["qualification"]}
    soft_skill: {state["soft_skill"]}
    technology_and_tools: {state["technology_and_tools"]}
    experience_year: {state["experience_year"]}
    project_experience: {state["project_experience"]}
    other_info: {state["other_info"]}

    RULES:
    Give score ranging from 0 to 100 strictly.
    Use only information explicitly present in the resume.
    Do not hallucinate, invent, or assume missing information.
  
    Use industry-standard semantic understanding only when confidence is high.

    ALLOWED INFERENCE examples:
    Django, Spring Boot → Backend Development
    React, Angular → Frontend Development

    SCORING & FEEDBACK:
    skill_score: semantic match between JD skills and resume skills.
    technology_and_tools_score: exact or equivalent match.
    qualification_score: qualification/education match.
    experience_score: use only explicitly stated experience.
    soft_skill_score: explicit or strongly evidenced soft skills.
    achievement_score: awards, hackathons, certifications, publications.
    internship_score: relevance of internships to the JD.
    has_strong_project: true if projects strongly align with JD requirements.
    feedback_summary: 1-2 sentence constructive breakdown of key strengths and missing items.

IMPORTANT:
Never return null.
All score fields must be numbers between 0 and 100.
If information is missing, return 0.
    Return ONLY the json schema matching the Pydantic schema and strictly no extra explanation or text required.
    {parser.get_format_instructions()}
    """
    result = safe_chain_invoke(
        model, parser, prompt,
        fallback_factory=lambda: get_ats_schema(
            skill_score=0.0,
            experience_score=0.0,
            qualification_score=0.0,
            achievement_score=0.0,
            technology_and_tools_score=0.0,
            internship_score=0.0,
            soft_skill_score=0.0,
            has_strong_project=False,
            feedback_summary="ATS scoring encountered a JSON parsing error."
        )
    )
    print(result)
    return {
        "skill_score": result.skill_score,
        "experience_score": result.experience_score,
        "qualification_score": result.qualification_score,
        "achievement_score": result.achievement_score,
        "technology_and_tools_score": result.technology_and_tools_score,
        "internship_score": result.internship_score,
        "soft_skill_score": result.soft_skill_score,
        "has_strong_project": result.has_strong_project,
        "feedback_summary": getattr(result, "feedback_summary", ""),
    }


# ── Graph ─────────────────────────────────────────────────────
def build_ats_graph():
    graph = StateGraph(AtsState)
    graph.add_node("summarise_desc", summarise_desc)
    graph.add_node("matching", matching)
    graph.add_edge(START, "summarise_desc")
    graph.add_edge("summarise_desc", "matching")
    graph.add_edge("matching", END)
    return graph.compile()


# Compile graph once at the module level to optimize performance
ATS_GRAPH = build_ats_graph()


def safe_score(value):
    return 0 if value is None else value


# ── Final weighted score ──────────────────────────────────────
def calculate_final_ats_score(final_state: dict, weights: dict) -> float:
    w = weights
    score = (
        safe_score(final_state["skill_score"]) * w.get("skill", 0.0)
        + safe_score(final_state["experience_score"]) * w.get("experience", 0.0)
        + safe_score(final_state["qualification_score"]) * w.get("qualification", 0.0)
        + safe_score(final_state["achievement_score"]) * w.get("achievement", 0.0)
        + safe_score(final_state["internship_score"]) * w.get("internship", 0.0)
        + safe_score(final_state["soft_skill_score"]) * w.get("soft_skill", 0.0)
        + (100 if final_state["has_strong_project"] else 0) * w.get("has_strong_project", 0.0)
        + safe_score(final_state["technology_and_tools_score"]) * w.get("technology_and_tools", 0.0)
    )
    return round(score, 2)


# ── Main entry point ──────────────────────────────────────────
def run_ats_scoring(resume_text: str, job_description: str, weights: Optional[dict] = None, threshold: Optional[float] = None) -> dict:
    """
    Returns:
        {
            "final_score": float,
            "breakdown": { skill_score, experience_score, ... },
            "passed": bool
        }
    """
    initial_state = {"desc": job_description, "resume": resume_text}
    final_state = ATS_GRAPH.invoke(initial_state)

    # Process custom weights
    active_weights = dict(ATS_WEIGHTS)
    if weights and isinstance(weights, dict):
        for k, v in weights.items():
            if k in active_weights:
                active_weights[k] = float(v)

    # Normalize weights so they sum to 1.0
    total_weights = sum(active_weights.values())
    if total_weights > 0:
        for k in active_weights:
            active_weights[k] = active_weights[k] / total_weights

    final_score = calculate_final_ats_score(final_state, active_weights)
    print(final_score)
    print(final_state)
    
    pass_threshold = threshold if threshold is not None else getattr(settings, "ATS_PASS_THRESHOLD", 50.0)
    
    return {
        "final_score": final_score,
        "feedback_summary": final_state.get("feedback_summary", ""),
        "breakdown": {
            "skill_score":               final_state["skill_score"],
            "experience_score":          final_state["experience_score"],
            "qualification_score":       final_state["qualification_score"],
            "achievement_score":         final_state["achievement_score"],
            "technology_and_tools_score": final_state["technology_and_tools_score"],
            "internship_score":          final_state["internship_score"],
            "soft_skill_score":          final_state["soft_skill_score"],
            "has_strong_project":        final_state["has_strong_project"],
        },
        "passed": final_score >= pass_threshold,
    }


# ── Student ATS Scorer Analysis functions ──────────────────────

def extract_pdf_metadata(file_stream) -> dict:
    """
    Extract visual metadata from PDF stream using PyMuPDF (fitz)
    to check fonts, sizes, colors, page count, etc.
    """
    try:
        import fitz
        file_stream.seek(0)
        doc = fitz.open(stream=file_stream.read(), filetype="pdf")
        file_stream.seek(0)
        
        fonts_used = set()
        font_sizes = []
        colors_used = set()
        num_pages = len(doc)
        
        for page in doc:
            try:
                text_dict = page.get_text("dict")
                blocks = text_dict.get("blocks", [])
                for b in blocks:
                    if "lines" in b:
                        for l in b["lines"]:
                            for s in l["spans"]:
                                font_name = s.get("font", "")
                                if font_name:
                                    fonts_used.add(font_name)
                                size = s.get("size")
                                if size is not None:
                                    font_sizes.append(size)
                                color = s.get("color")
                                if color is not None:
                                    # Convert integer color to hex
                                    r = (color >> 16) & 255
                                    g = (color >> 8) & 255
                                    b_val = color & 255
                                    colors_used.add(f"#{r:02x}{g:02x}{b_val:02x}")
            except Exception as e:
                print(f"[ATS-Metadata] Error parsing page: {e}")
                
        common_fonts = list(fonts_used)[:15]
        unique_colors = list(colors_used)[:10]
        
        min_size = min(font_sizes) if font_sizes else 10.0
        max_size = max(font_sizes) if font_sizes else 10.0
        avg_size = sum(font_sizes) / len(font_sizes) if font_sizes else 10.0
        
        has_images = False
        for page in doc:
            if page.get_images():
                has_images = True
                break
                
        return {
            "num_pages": num_pages,
            "fonts": common_fonts,
            "font_sizes": {
                "min": round(min_size, 1),
                "max": round(max_size, 1),
                "average": round(avg_size, 1)
            },
            "colors": unique_colors,
            "has_images": has_images
        }
    except Exception as e:
        print(f"[ATS-Metadata] General PDF metadata parsing error: {e}")
        return {
            "num_pages": 1,
            "fonts": ["Unknown"],
            "font_sizes": {"min": 10.0, "max": 12.0, "average": 11.0},
            "colors": ["#000000"],
            "has_images": False
        }


def analyze_resume_for_student(resume_text: str, pdf_metadata: dict, target_role: str = "", target_jd: str = "") -> StudentAtsAuditSchema:
    model = get_ats_llm()
    parser = PydanticOutputParser(pydantic_object=StudentAtsAuditSchema)
    
    role_str = target_role if target_role else "General Professional Role"
    jd_str = target_jd if target_jd else "General professional ATS guidelines (no specific JD provided)"
    
    prompt = f"""
    You are an Expert ATS Resume Auditor and Career Coach.
    Analyze the candidate's resume raw text and its visual metadata, and perform a highly detailed audit.
    Provide constructive feedback and grade the resume across multiple dimensions.
    
    RESUME TEXT:
    -------------------
    {resume_text}
    -------------------
    
    VISUAL/METADATA ANALYSIS (from PDF inspection):
    -------------------
    - Number of pages: {pdf_metadata.get("num_pages", 1)}
    - Fonts detected: {pdf_metadata.get("fonts", [])}
    - Font sizes: Min {pdf_metadata.get("font_sizes", {}).get("min")}pt, Max {pdf_metadata.get("font_sizes", {}).get("max")}pt, Avg {pdf_metadata.get("font_sizes", {}).get("average")}pt
    - Colors used: {pdf_metadata.get("colors", [])}
    - Has images/graphics: {pdf_metadata.get("has_images", False)}
    -------------------
    
    TARGET JOB DETAIL (If none provided, audit against general modern resume standards):
    - Target Role/Title: {role_str}
    - Target Job Description: {jd_str}
    
    Please audit the resume on the following 5 areas and score each area strictly between 0 and 100.
    
    1. Formatting & Structure:
       - Layout consistency, margins, logical sections (Education, Experience, Skills, Projects).
       - Length (1 page is optimal for students/recent grads; max 2 pages).
       - Presence of tables, charts, columns (note: double column layouts can cause reading issues for older ATS systems).
       
    2. Font & Typography:
       - Readability and font family choices (Arial, Calibri, Helvetica are preferred; decorative fonts are bad).
       - Consistency of size and hierarchy (Min size should not be under 9pt; standard sizes are 10-12pt for body).
       - Color usage (Professional/minimal color scheme is best; too many colors is unprofessional).
       
    3. Content & Impact:
       - Section completeness (missing contact details, missing skills, etc.).
       - Use of action verbs at the start of bullet points (e.g., Led, Developed, Optimized, Managed).
       - Quantifiable metrics and results (e.g., "Increased performance by 25%", "Managed a team of 4").
       
    4. Grammar & Style:
       - Spelling mistakes, grammar errors, and typos.
       - Correct verb tenses (past tense for past jobs, present for current).
       - Active vs passive voice, tone consistency (should be professional and third-person).
       
    5. Word Choice & Buzzwords:
       - Misplaced or incorrect word usage.
       - Overused buzzwords/clichés (e.g., "Team player", "Hard worker", "Synergy", "Result-oriented") and recommendations to replace them with active/concrete action verbs or achievements.
       - Correct terms and terminology for the field.
       
    For each category, provide:
    - Score (0 to 100)
    - List of constructive issues/mistakes. Each issue must have:
      * 'issue': clear description of the mistake.
      * 'severity': 'high', 'medium', or 'low'.
      * 'suggestion': how to fix it (e.g., "Replace 'Responsible for...' with 'Spearheaded...'").
      * 'location': which section or bullet point it is located in (or 'general').
      * 'context': a snippet from the resume showing the issue (if applicable).
      
    Also provide a general summary, a list of overall strengths of the resume, and calculate an overall_score (weighted average of the category scores).
    
    Return ONLY the json schema matching the Pydantic schema and strictly no extra explanation or text required.
    {parser.get_format_instructions()}
    """
    
    fallback = StudentAtsAuditSchema(
        overall_score=0.0,
        formatting_score=0.0,
        formatting_feedback=[],
        font_score=0.0,
        font_feedback=[],
        content_score=0.0,
        content_feedback=[],
        grammar_score=0.0,
        grammar_feedback=[],
        word_choice_score=0.0,
        word_choice_feedback=[],
        strengths=[],
        summary="ATS Resume audit failed to parse the LLM response."
    )
    
    result = safe_chain_invoke(model, parser, prompt, fallback_factory=lambda: fallback)
    return result


# ── Resume Auto-Fixer ──
import json
from django.core.files.base import ContentFile
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.lib import colors
from io import BytesIO

class ResumeSectionItem(BaseModel):
    heading: str = Field(description="Heading of the entry, e.g., 'Senior Software Engineer at ABC Company' or 'B.S. in Computer Science'")
    subheading: str = Field(description="Subheading of the entry, e.g., 'June 2022 - Present' or 'University of California, GPA: 3.8'")
    bullets: List[str] = Field(description="A list of bullet points detailing achievements, responsibilities, or details")

class ResumeSection(BaseModel):
    title: str = Field(description="Title of the section, e.g., 'Work Experience', 'Projects', 'Education', 'Skills'")
    items: List[ResumeSectionItem] = Field(description="List of items in this section")

class CorrectedResumeSchema(BaseModel):
    name: str = Field(description="The full name of the candidate")
    contact: List[str] = Field(description="List of contact details, e.g., email, phone, location, LinkedIn, GitHub")
    summary: str = Field(description="A professional summary or objective statement, optimized for ATS and spelling/grammar corrected")
    sections: List[ResumeSection] = Field(description="List of sections containing resume details, fully corrected and professionally formatted")


def generate_resume_pdf(corrected_data: CorrectedResumeSchema, font_name: str = "Helvetica") -> bytes:
    # Map font name
    print(corrected_data)
    font_name_lower = font_name.lower()
    if "times" in font_name_lower or "roman" in font_name_lower:
        base_font = "Times-Roman"
        bold_font = "Times-Bold"
        italic_font = "Times-Italic"
    elif "courier" in font_name_lower:
        base_font = "Courier"
        bold_font = "Courier-Bold"
        italic_font = "Courier-Oblique"
    else:
        base_font = "Helvetica"
        bold_font = "Helvetica-Bold"
        italic_font = "Helvetica-Oblique"
        
    buffer = BytesIO()
    
    # 0.5 inch (36 pt) margins
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )
    
    styles = getSampleStyleSheet()
    
    primary_color = colors.HexColor("#1e293b")
    text_color = colors.HexColor("#334155")
    
    title_style = ParagraphStyle(
        'ResumeTitle',
        parent=styles['Normal'],
        fontName=bold_font,
        fontSize=18,
        leading=22,
        textColor=primary_color,
        alignment=TA_CENTER,
        spaceAfter=4
    )
    
    contact_style = ParagraphStyle(
        'ResumeContact',
        parent=styles['Normal'],
        fontName=base_font,
        fontSize=9,
        leading=12,
        textColor=text_color,
        alignment=TA_CENTER,
        spaceAfter=10
    )
    
    summary_style = ParagraphStyle(
        'ResumeSummary',
        parent=styles['Normal'],
        fontName=base_font,
        fontSize=9.5,
        leading=13.5,
        textColor=text_color,
        spaceAfter=10
    )
    
    header_style = ParagraphStyle(
        'ResumeHeader',
        parent=styles['Normal'],
        fontName=bold_font,
        fontSize=11,
        leading=14,
        textColor=primary_color,
        spaceBefore=6,
        spaceAfter=3,
        keepWithNext=True
    )
    
    item_heading_left = ParagraphStyle(
        'ItemHeadingLeft',
        parent=styles['Normal'],
        fontName=bold_font,
        fontSize=9.5,
        leading=12.5,
        textColor=primary_color
    )
    
    item_heading_right = ParagraphStyle(
        'ItemHeadingRight',
        parent=styles['Normal'],
        fontName=base_font,
        fontSize=9,
        leading=12,
        textColor=text_color,
        alignment=TA_RIGHT
    )
    
    bullet_style = ParagraphStyle(
        'ResumeBullet',
        parent=styles['Normal'],
        fontName=base_font,
        fontSize=9,
        leading=13,
        textColor=text_color,
        leftIndent=12,
        firstLineIndent=-8,
        spaceAfter=2
    )
    
    skills_text_style = ParagraphStyle(
        'ResumeSkillsText',
        parent=styles['Normal'],
        fontName=base_font,
        fontSize=9,
        leading=13,
        textColor=text_color,
        spaceAfter=3
    )

    story = []
    
    # 1. Header (Name)
    story.append(Paragraph(corrected_data.name, title_style))
    
    # 2. Contact info line
    if corrected_data.contact:
        contact_text = "  |  ".join(corrected_data.contact)
        story.append(Paragraph(contact_text, contact_style))
    
    # 3. Summary
    if corrected_data.summary:
        story.append(Paragraph(corrected_data.summary, summary_style))
        
    # 4. Sections
    for section in corrected_data.sections:
        if not section.items:
            continue
            
        header_table_data = [[Paragraph(section.title.upper(), header_style)]]
        header_table = Table(header_table_data, colWidths=[540])
        header_table.setStyle(TableStyle([
            ('LINEBELOW', (0,0), (-1,-1), 1, primary_color),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        story.append(header_table)
        story.append(Spacer(1, 3))
        
        # Check if this is a skills/technologies/tools section
        is_skills_section = any(k in section.title.lower() for k in ["skill", "technology", "technologies", "tool"])
        
        if is_skills_section:
            for item in section.items:
                skills_list = []
                if item.bullets:
                    skills_list = [b.strip() for b in item.bullets if b.strip()]
                elif item.subheading:
                    skills_list = [s.strip() for s in item.subheading.split(",") if s.strip()]
                
                if skills_list:
                    skills_str = ", ".join(skills_list)
                    text = f"<b>{item.heading}:</b> {skills_str}"
                else:
                    text = f"<b>{item.heading}</b>"
                    if item.subheading:
                        text += f" - {item.subheading}"
                
                story.append(Paragraph(text, skills_text_style))
            story.append(Spacer(1, 4))
        else:
            for item in section.items:
                # Table layout for heading / subheading
                heading_p = Paragraph(item.heading, item_heading_left)
                subheading_p = Paragraph(item.subheading, item_heading_right)
                
                item_table = Table([[heading_p, subheading_p]], colWidths=[380, 160])
                item_table.setStyle(TableStyle([
                    ('VALIGN', (0,0), (-1,-1), 'TOP'),
                    ('LEFTPADDING', (0,0), (-1,-1), 0),
                    ('RIGHTPADDING', (0,0), (-1,-1), 0),
                    ('BOTTOMPADDING', (0,0), (-1,-1), 1),
                    ('TOPPADDING', (0,0), (-1,-1), 1),
                ]))
                story.append(item_table)
                
                for bullet in item.bullets:
                    story.append(Paragraph(f"&bull;&nbsp;&nbsp;{bullet}", bullet_style))
                    
                story.append(Spacer(1, 3))
            
    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def build_resilient_fallback_resume(analysis) -> CorrectedResumeSchema:
    user = analysis.user
    full_name = user.get_full_name() or user.username
    profile = getattr(user, 'user_profile', None)
    
    resume_text = (analysis.resume_text or "").strip()
    raw_lines = [line.strip() for line in resume_text.splitlines() if line.strip()]
    
    contact_list = []
    if user.email:
        contact_list.append(user.email)
    if profile:
        if profile.phone:
            contact_list.append(profile.phone)
        if profile.location:
            contact_list.append(profile.location)
            
    summary_text = (
        profile.bio if (profile and profile.bio) else
        f"Detail-oriented candidate seeking engineering opportunities as {analysis.target_role or 'Software Engineer'}. Skilled in problem solving, software development, and technical architecture."
    )
    
    sections = []
    
    # Extract sections dynamically from raw resume text if available
    current_section_title = None
    current_items = []
    current_heading = "Overview"
    current_bullets = []
    
    section_keywords = {
        "education": "Education",
        "academic": "Education",
        "experience": "Work Experience",
        "employment": "Work Experience",
        "work": "Work Experience",
        "project": "Projects",
        "skills": "Technical Skills",
        "technologies": "Technical Skills",
        "achievements": "Key Achievements",
        "certifications": "Certifications"
    }

    for line in raw_lines:
        line_lower = line.lower()
        is_header = False
        for kw, title in section_keywords.items():
            if kw in line_lower and len(line) < 40 and not line.startswith("•") and not line.startswith("-"):
                if current_bullets or current_heading != "Overview":
                    current_items.append(ResumeSectionItem(
                        heading=current_heading,
                        subheading="",
                        bullets=current_bullets
                    ))
                    current_bullets = []
                if current_items and current_section_title:
                    sections.append(ResumeSection(title=current_section_title, items=current_items))
                    current_items = []
                current_section_title = title
                current_heading = "Details"
                is_header = True
                break
                
        if is_header:
            continue

        if current_section_title:
            if line.startswith("•") or line.startswith("-") or line.startswith("*"):
                bullet_clean = line.lstrip("•-* ").strip()
                if bullet_clean:
                    current_bullets.append(bullet_clean)
            elif len(line) < 60 and not line.endswith("."):
                if current_bullets:
                    current_items.append(ResumeSectionItem(
                        heading=current_heading,
                        subheading="",
                        bullets=current_bullets
                    ))
                    current_bullets = []
                current_heading = line
            else:
                current_bullets.append(line)

    if current_bullets or (current_heading != "Overview" and current_section_title):
        current_items.append(ResumeSectionItem(
            heading=current_heading,
            subheading="",
            bullets=current_bullets
        ))
    if current_items and current_section_title:
        sections.append(ResumeSection(title=current_section_title, items=current_items))

    # Fallback to candidate profile data if text parsing extracted no sections
    if not sections:
        skills_list = profile.skills if (profile and profile.skills) else ["Python", "JavaScript", "SQL", "REST APIs", "Git"]
        sections.append(ResumeSection(
            title="Technical Skills",
            items=[ResumeSectionItem(heading="Core Skills & Technologies", subheading=", ".join(skills_list), bullets=[])]
        ))
        
        edu_heading = profile.degree if (profile and profile.degree) else "Bachelor of Technology / Computer Science"
        edu_sub = profile.college_name if (profile and profile.college_name) else "University / Institute"
        if profile and profile.graduation_year:
            edu_sub += f" ({profile.graduation_year})"
        sections.append(ResumeSection(
            title="Education",
            items=[ResumeSectionItem(heading=edu_heading, subheading=edu_sub, bullets=["Focus on software engineering principles and computer science fundamentals."])]
        ))
        
        if profile and profile.projects:
            p_items = [ResumeSectionItem(heading=p.get("title", "Project"), subheading=p.get("tech_stack", ""), bullets=[p.get("description", "")]) for p in profile.projects]
            sections.append(ResumeSection(title="Projects", items=p_items))
        else:
            sections.append(ResumeSection(
                title="Projects",
                items=[ResumeSectionItem(heading=f"{analysis.target_role or 'Software'} Project", subheading="Full-Stack Implementation", bullets=["Developed and deployed scalable software applications with clean architecture."])]
            ))
            
        if profile and profile.experience:
            e_items = [ResumeSectionItem(heading=f"{e.get('role', 'Role')} at {e.get('company', 'Company')}", subheading=e.get("duration", ""), bullets=[e.get("description", "")]) for e in profile.experience]
            sections.append(ResumeSection(title="Work Experience", items=e_items))
        else:
            sections.append(ResumeSection(
                title="Work Experience",
                items=[ResumeSectionItem(heading="Software Engineering Lead", subheading="Practical Experience", bullets=["Collaborated in software teams to design, build, and optimize backend and frontend services."])]
            ))
            
    return CorrectedResumeSchema(
        name=full_name,
        contact=contact_list,
        summary=summary_text,
        sections=sections
    )


def auto_fix_resume(analysis, approved_issues=None) -> bytes:
    # Get metadata fonts
    try:
        analysis.resume_file.seek(0)
        metadata = extract_pdf_metadata(analysis.resume_file)
        fonts = metadata.get("fonts", [])
    except Exception:
        fonts = ["Helvetica"]
        
    mapped_font = "Helvetica"
    for f in fonts:
        fl = f.lower()
        if "times" in fl or "roman" in fl or "serif" in fl:
            mapped_font = "Times-Roman"
            break
        elif "courier" in fl or "mono" in fl:
            mapped_font = "Courier"
            break

    # Get LLM response
    model = get_ats_llm()
    parser = PydanticOutputParser(pydantic_object=CorrectedResumeSchema)
    
    issues_to_use = approved_issues if approved_issues is not None else analysis.feedback_details
    
    prompt = f"""
    You are an Expert Resume Editor & ATS Formatting Specialist.
    Your task is to fix formatting, layout, alignment, typography, and spelling issues in the candidate's original resume, WITHOUT deleting or replacing their original experience or content.
    
    ORIGINAL RESUME TEXT:
    -------------------
    {analysis.resume_text}
    -------------------
    
    IDENTIFIED ISSUES TO FIX:
    -------------------
    - Formatting/Structure: {json.dumps(issues_to_use.get("formatting", []))}
    - Font/Typography: {json.dumps(issues_to_use.get("font", []))}
    - Content/Achievements: {json.dumps(issues_to_use.get("content", []))}
    - Grammar/Spelling: {json.dumps(issues_to_use.get("grammar", []))}
    - Word Choice/Buzzwords: {json.dumps(issues_to_use.get("word_choice", []))}
    -------------------
    
    TARGET ROLE: {analysis.target_role or "General standards"}
    TARGET JOB DESCRIPTION: {analysis.target_jd or "General professional standards"}
    
    STRICT PRESERVATION INSTRUCTIONS:
    1. PRESERVE ALL ORIGINAL FACTUAL CONTENT: Retain all jobs, companies, degrees, institutions, dates, projects, skills, and bullet points from the candidate's original resume text.
    2. DO NOT DELETE OR OMIT SECTIONS: Organize the original content into clean ATS standard section headings (Education, Experience, Projects, Skills) while keeping 100% of their actual accomplishments intact.
    3. CORRECT ONLY TYPOS & FORMATTING: Fix spelling, grammatical errors, and passive phrasing without wiping out original details or replacing them with dummy templates.
    4. Ensure section items contain proper headings, subheadings, and bullet points.
    
    Return ONLY the json schema matching the Pydantic schema and strictly no extra explanation or text required.
    {parser.get_format_instructions()}
    """
    
    fallback = build_resilient_fallback_resume(analysis)
    corrected_data = safe_chain_invoke(model, parser, prompt, fallback_factory=lambda: fallback)
    
    if not corrected_data.sections:
        corrected_data = fallback

    # Save the structured JSON back to database
    analysis.fixed_resume_json = corrected_data.model_dump()
    analysis.save(update_fields=['fixed_resume_json'])
    
    # Generate PDF bytes
    pdf_bytes = generate_resume_pdf(corrected_data, font_name=mapped_font)
    return pdf_bytes


def get_or_create_initial_json(analysis):
    if analysis.fixed_resume_json:
        summary = analysis.fixed_resume_json.get("summary", "")
        sections = analysis.fixed_resume_json.get("sections", [])
        if "auto-correction failed" not in summary.lower() and len(sections) > 0:
            return analysis.fixed_resume_json
    
    # If missing or broken fallback, run LLM to structure original resume text into CorrectedResumeSchema
    model = get_ats_llm()
    parser = PydanticOutputParser(pydantic_object=CorrectedResumeSchema)
    
    prompt = f"""
    You are an Expert Resume Editor & Parser.
    Your task is to take the candidate's original resume text and convert it into a clean, professional ATS JSON output, PRESERVING ALL original content.
    
    ORIGINAL RESUME TEXT:
    -------------------
    {analysis.resume_text or "No text extracted from original file."}
    -------------------
    
    STRICT PRESERVATION INSTRUCTIONS:
    1. PRESERVE 100% OF ORIGINAL DATA: Retain all candidate experience, companies, job titles, education, degrees, projects, skills, dates, and bullet points.
    2. DO NOT DELETE OR OVERWRITE: Do NOT omit any sections or bullet points from the candidate's original text.
    3. Fix typos and structure cleanly into the Pydantic schema format.
    
    Return ONLY the json schema matching the Pydantic schema.
    {parser.get_format_instructions()}
    """
    fallback = build_resilient_fallback_resume(analysis)
    corrected_data = safe_chain_invoke(model, parser, prompt, fallback_factory=lambda: fallback)
    
    if not corrected_data.sections:
        corrected_data = fallback

    analysis.fixed_resume_json = corrected_data.model_dump()
    analysis.save(update_fields=['fixed_resume_json'])
    return analysis.fixed_resume_json


def chat_fix_resume(analysis, user_instruction: str) -> bytes:
    current_json = get_or_create_initial_json(analysis)
    
    model = get_ats_llm()
    parser = PydanticOutputParser(pydantic_object=CorrectedResumeSchema)
    
    prompt = f"""
    You are an Expert Resume Editor.
    You are given a candidate's current resume in JSON format, and a user request to modify, add, or fix something.
    Your task is to apply the requested changes to the resume JSON precisely, and return the updated resume matching the Pydantic schema format.
    
    CURRENT RESUME JSON:
    -------------------
    {json.dumps(current_json, indent=2)}
    -------------------
    
    USER EDIT REQUEST:
    -------------------
    {user_instruction}
    -------------------
    
    CRITICAL PRESERVATION & EDIT INSTRUCTIONS:
    1. DO NOT DELETE OR OMIT EXISTING CONTENT: Maintain all existing sections, work experience entries, job titles, education, projects, and bullet points from CURRENT RESUME JSON unless the user explicitly requested to delete a specific item.
    2. APPLY SPECIFIC EDITS PRECISELY: Only add, modify, or rephrase the items explicitly requested in USER EDIT REQUEST.
    3. NO HALLUCINATION: Do NOT fabricate unprovided personal details, company names, or degrees.
    4. Keep all formatting consistent, professional, and ATS-friendly.
    5. Ensure the output strictly matches the Pydantic schema.
    
    Return ONLY the json schema matching the Pydantic schema.
    {parser.get_format_instructions()}
    """
    
    fallback_schema = build_resilient_fallback_resume(analysis)
    fallback = CorrectedResumeSchema(**current_json) if (current_json and current_json.get("sections")) else fallback_schema
    
    updated_data = safe_chain_invoke(model, parser, prompt, fallback_factory=lambda: fallback)
    
    if not updated_data.sections:
        updated_data = fallback_schema

    # Save the updated JSON back to database
    analysis.fixed_resume_json = updated_data.model_dump()
    analysis.save(update_fields=['fixed_resume_json'])
    
    # Map font name for PDF compilation
    try:
        analysis.resume_file.seek(0)
        metadata = extract_pdf_metadata(analysis.resume_file)
        fonts = metadata.get("fonts", [])
    except Exception:
        fonts = ["Helvetica"]
        
    mapped_font = "Helvetica"
    for f in fonts:
        fl = f.lower()
        if "times" in fl or "roman" in fl or "serif" in fl:
            mapped_font = "Times-Roman"
            break
        elif "courier" in fl or "mono" in fl:
            mapped_font = "Courier"
            break
            
    pdf_bytes = generate_resume_pdf(updated_data, font_name=mapped_font)
    return pdf_bytes


class RecruiterAssistantSchema(BaseModel):
    message: str = Field(description="A helpful, professional response to the recruiter's request.")
    job_description: Optional[str] = Field(None, description="The generated or refined job description text (if relevant).")
    required_skills: Optional[str] = Field(None, description="The comma-separated skills list (e.g. 'React, JavaScript, Python') (if relevant).")
    custom_questions: Optional[List[str]] = Field(None, description="A list of proposed interview questions (if relevant).")


def run_recruiter_helper_chat(user_instruction: str, current_jd: str = "", current_skills: str = "", current_questions: list = None) -> dict:
    import json
    if current_questions is None:
        current_questions = []
        
    model = get_ats_llm()
    parser = PydanticOutputParser(pydantic_object=RecruiterAssistantSchema)
    
    prompt = f"""
    You are an AI recruitment consultant assisting a recruiter to post a new job opportunity.
    Your goal is to help them write or refine the Job Description (JD), list key required skills, or suggest custom interview questions.
    
    CURRENT FORM STATE (If populated):
    -------------------
    - Job Description: {current_jd}
    - Required Skills: {current_skills}
    - Existing Custom Questions: {json.dumps(current_questions)}
    -------------------
    
    RECRUITER REQUEST:
    -------------------
    {user_instruction}
    -------------------
    
    CRITICAL INSTRUCTIONS:
    1. DO NOT invent, hallucinate, or fabricate any candidates, scores, or achievements.
    2. Provide helpful suggestions, refine what they wrote, or generate new sections as requested.
    3. Under `job_description`, output the formatted job description text (use standard formatting, no markdown tags like # inside the text).
    4. Under `required_skills`, output a comma-separated list of skills.
    5. Under `custom_questions`, list clean, concise interview questions appropriate for evaluating this role.
    6. Return strictly valid JSON matching the schema.
    
    {parser.get_format_instructions()}
    """
    
    fallback = RecruiterAssistantSchema(
        message="I'm sorry, I encountered an issue processing your request. Please try again.",
        job_description=current_jd,
        required_skills=current_skills,
        custom_questions=current_questions
    )
    
    result = safe_chain_invoke(model, parser, prompt, fallback_factory=lambda: fallback)
    return result.model_dump()


class ProfileAssistantSchema(BaseModel):
    message: str = Field(description="A friendly, encouraging response explaining what actions Subh AI took or answering the user's profile query.")
    full_name: Optional[str] = Field(None, description="Updated full name if specified by user.")
    phone: Optional[str] = Field(None, description="Updated phone number if specified by user.")
    location: Optional[str] = Field(None, description="Updated location if specified by user.")
    bio: Optional[str] = Field(None, description="Updated bio/career summary if specified by user.")
    college_name: Optional[str] = Field(None, description="Updated college or university name if specified by user.")
    degree: Optional[str] = Field(None, description="Updated degree/major if specified by user.")
    education_level: Optional[str] = Field(None, description="Updated education level if specified by user.")
    graduation_year: Optional[str] = Field(None, description="Updated graduation year if specified by user.")
    skills: Optional[List[str]] = Field(None, description="Updated complete list of technical/professional skills if specified or modified by user.")
    interests: Optional[List[str]] = Field(None, description="Updated list of career interests if specified by user.")
    company_name: Optional[str] = Field(None, description="Updated company name if recruiter/specified.")
    designation: Optional[str] = Field(None, description="Updated designation/role title if specified.")
    company_website: Optional[str] = Field(None, description="Updated company website if specified.")
    hiring_focus: Optional[str] = Field(None, description="Updated hiring focus if specified.")
    sync_from_resume: Optional[bool] = Field(False, description="Set to true if user explicitly asks to sync profile from resume.")


def run_profile_assistant_chat(user_instruction: str, current_profile: dict, latest_resume_data: dict = None) -> dict:
    import json
    model = get_ats_llm()
    parser = PydanticOutputParser(pydantic_object=ProfileAssistantSchema)

    prompt = f"""
    You are Subh AI ⚡, an intelligent Career & Profile Assistant.
    Your task is to help the user manage, summarize, or update their User Profile details through natural language instructions.

    CURRENT USER PROFILE:
    -------------------
    {json.dumps(current_profile, indent=2)}
    -------------------

    LATEST RESUME DATA (If available):
    -------------------
    {json.dumps(latest_resume_data, indent=2) if latest_resume_data else "No resume uploaded yet."}
    -------------------

    USER INSTRUCTION:
    -------------------
    {user_instruction}
    -------------------

    CRITICAL INSTRUCTIONS:
    1. If the user asks to add/update skills (e.g. "Add Python and React", "Update skills: Docker, AWS"), include the updated complete list of skills in `skills`.
    2. If the user asks to update bio, phone, location, college, degree, or experience, extract and set the corresponding fields.
    3. If the user asks to sync profile from resume, set `sync_from_resume` to true.
    4. Under `message`, write a clear, friendly, and helpful response summarizing what was updated or answering their question.
    5. Return strictly valid JSON matching the schema.

    {parser.get_format_instructions()}
    """

    fallback = ProfileAssistantSchema(
        message="Subh AI processed your profile request. Check your updated profile page for details!",
        skills=current_profile.get("skills", [])
    )

    result = safe_chain_invoke(model, parser, prompt, fallback_factory=lambda: fallback)
    return result.model_dump()



