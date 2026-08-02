"""
ATS Scoring Service
Extracted from Jupyter notebook — logic unchanged.
"""
import os
import re
from typing import TypedDict, Optional
from pydantic import BaseModel, Field
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import RunnableLambda
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END, START
from django.conf import settings
from langchain_groq import ChatGroq

def clean_llm_output(message):
    text = message.content if hasattr(message, "content") else str(message)
    json_block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if json_block:
        return json_block.group(1)
    start = text.find("{")
    end   = text.rfind("}")
    if start != -1 and end != -1:
        return text[start:end + 1]
    return text

cleaner = RunnableLambda(clean_llm_output)

def safe_chain_invoke(llm, parser, prompt, fallback_factory):
    """
    Invokes the LLM and runs it through the cleaner and parser.
    If the parser fails, tries standard JSON parsing and mapping.
    If everything fails, returns a fallback object populated by fallback_factory.
    """
    chain_raw = llm | cleaner
    try:
        raw_text = chain_raw.invoke(prompt)
    except Exception as e:
        print(f"[SafeInvoke-ATS] LLM invocation failed: {e}")
        return fallback_factory()

    # 2. Try parsing with Pydantic parser
    try:
        return parser.parse(raw_text)
    except Exception as parse_err:
        print(f"[SafeInvoke-ATS] Pydantic parser failed, attempting manual JSON parse: {parse_err}")
        
    # 3. Try standard JSON parsing
    try:
        import json
        clean_text = clean_llm_output(raw_text)
        data = json.loads(clean_text)
        pydantic_class = parser.pydantic_object
        
        # Build kwargs, falling back to defaults if missing or incorrect type
        kwargs = {}
        for name, field in pydantic_class.model_fields.items():
            default = field.default if not field.is_required() else None
            val = data.get(name, default)
            kwargs[name] = val
            
        return pydantic_class(**kwargs)
    except Exception as fallback_err:
        print(f"[SafeInvoke-ATS] Manual parsing failed: {fallback_err}")
        return fallback_factory()

# ── LLM ──────────────────────────────────────────────────────
def get_ats_llm():
    api_key = getattr(settings, "GROQ_API_KEY", None) or os.getenv("GROQ_API_KEY")
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=api_key,
        temperature=0.1
    )


# ── Schemas ───────────────────────────────────────────────────
class get_ats_schema(BaseModel):
    skill_score: float = Field(default=0, description="calculate skill_score")
    experience_score: float = Field(default=0, description="calculate experience_score")
    qualification_score: float = Field(default=0, description="calculate education_score")
    achievement_score: float = Field(default=0, description="calculate achievement_score")
    technology_and_tools_score: float = Field(default=0, description="calculate the technology_and_tools_score")
    internship_score: float = Field(default=0, description="calculate internship_score")
    soft_skill_score: float = Field(default=0, description="calculate softskill_score")
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
    description:
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
    education_score: qualification match.
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

def safe_score(value):
    return 0 if value is None else value
# ── Final weighted score ──────────────────────────────────────
def calculate_final_ats_score(final_state: dict) -> float:
    w = ATS_WEIGHTS
    # score = (
    #     final_state["skill_score"]                * w["skill"]
    #     + final_state["experience_score"]         * w["experience"]
    #     + final_state["qualification_score"]      * w["qualification"]
    #     + final_state["achievement_score"]        * w["achievement"]
    #     + final_state["internship_score"]         * w["internship"]
    #     + final_state["soft_skill_score"]         * w["soft_skill"]
    #     + (100 if final_state["has_strong_project"] else 0) * w["has_strong_project"]
    #     + final_state["technology_and_tools_score"] * w["technology_and_tools"]
    # )
    score = (
    safe_score(final_state["skill_score"]) * w["skill"]
    + safe_score(final_state["experience_score"]) * w["experience"]
    + safe_score(final_state["qualification_score"]) * w["qualification"]
    + safe_score(final_state["achievement_score"]) * w["achievement"]
    + safe_score(final_state["internship_score"]) * w["internship"]
    + safe_score(final_state["soft_skill_score"]) * w["soft_skill"]
    + (100 if final_state["has_strong_project"] else 0) * w["has_strong_project"]
    + safe_score(final_state["technology_and_tools_score"]) * w["technology_and_tools"]
)
    return round(score, 2)


# ── Main entry point ──────────────────────────────────────────
def run_ats_scoring(resume_text: str, job_description: str) -> dict:
    """
    Returns:
        {
            "final_score": float,
            "breakdown": { skill_score, experience_score, ... },
            "passed": bool
        }
    """
    ats_app = build_ats_graph()
    initial_state = {"desc": job_description, "resume": resume_text}
    final_state = ats_app.invoke(initial_state)
    final_score = calculate_final_ats_score(final_state)
    print(final_score)
    print(final_state)
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
        "passed": final_score >= settings.ATS_PASS_THRESHOLD,
    }
