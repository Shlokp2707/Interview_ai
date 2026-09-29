"""
Professional Adaptive AI Technical Interviewer Service
Powered by LangGraph, LangChain, and Multi-LLM Provider Engine.
"""
import re, uuid, os
from collections import Counter
from typing import Annotated, Literal, TypedDict, Dict, Any, List, Optional
from pydantic import BaseModel, Field
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import RunnableLambda
from langchain_core.messages import HumanMessage, AIMessage
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt
from django.conf import settings
from .voice_analyzer import analyze_speaking
from .models import Application

# ── LLM Initializer ──────────────────────────────────────────────
def get_interview_llm(json_mode: bool = False, user=None):
    from .key_manager import get_api_key_for_user
    
    groq_key = get_api_key_for_user(user, "groq")
    gemini_key = get_api_key_for_user(user, "gemini")
    openai_key = get_api_key_for_user(user, "openai")
    
    kwargs = {}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    if groq_key:
        return ChatGroq(
            model="qwen/qwen3.8-27b",
            api_key=groq_key,
            temperature=0.2,
            **kwargs
        )
    elif gemini_key:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model="gemini-1.5-flash",
                google_api_key=gemini_key,
                temperature=0.2,
                **kwargs
            )
        except Exception as e:
            print(f"[InterviewService] Gemini LLM init failed: {e}")
            
    elif openai_key:
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model="gpt-4o-mini",
                api_key=openai_key,
                temperature=0.2,
                **kwargs
            )
        except Exception as e:
            print(f"[InterviewService] OpenAI LLM init failed: {e}")

    # Default platform fallback
    fallback_key = getattr(settings, "GROQ_API_KEY", None) or os.getenv("GROQ_API_KEY")
    return ChatGroq(
        model="qwen/qwen3.8-27b",
        api_key=fallback_key,
        temperature=0.2,
        **kwargs
    )


def format_conversation(conversation: list) -> str:
    lines = []
    for msg in conversation:
        if isinstance(msg, AIMessage) or (hasattr(msg, "type") and msg.type == "ai"):
            lines.append(f"Interviewer: {msg.content}")
        elif isinstance(msg, HumanMessage) or (hasattr(msg, "type") and msg.type == "human"):
            lines.append(f"Candidate: {msg.content}")
        else:
            content = msg.content if hasattr(msg, "content") else str(msg)
            lines.append(f"Message: {content}")
    return "\n".join(lines)


# ── JSON Output Cleaner ──────────────────────────────────────────
def clean_llm_output(message):
    text = message.content if hasattr(message, "content") else str(message)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    json_block = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", text)
    if json_block:
        return json_block.group(1).strip()
    start = text.find("{")
    end   = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1].strip()
    return text

cleaner = RunnableLambda(clean_llm_output)


# ── Pydantic Schemas ─────────────────────────────────────────────
class get_resume_schema(BaseModel):
    candidate_skills:     list[str] = Field(default=[], description="technical skills, languages, tools, frameworks")
    candidate_experience: list[str] = Field(default=[], description="work experience and roles")
    candidate_project:    list[str] = Field(default=[], description="projects, technologies, and claimed contributions")

class get_question_gen_schema(BaseModel):
    current_question: str      = Field(default="", description="the single primary technical question phrased professionally")
    covered_topics:   list[str] = Field(default_factory=list, description="list of technical topics covered by this question")

class ScoreEntry(BaseModel):
    question:   str = Field(default="", description="question asked")
    score:      int = Field(default=0,  description="score out of 10")
    evaluation: str = Field(default="", description="concise, objective evaluation summary")

class get_evaluate_schema(BaseModel):
    scores:            list[ScoreEntry] = Field(default=[], description="scores per answer")
    needs_followup:    bool             = Field(default=False, description="True ONLY IF answer is incomplete, ambiguous, superficial, or reveals a gap")
    next_question:     str              = Field(default="", description="the next adaptive question or follow-up question")
    topic_covered:     list[str]        = Field(default_factory=list, description="technical topics covered by next question")
    concept_evidence:  dict[str, str]   = Field(default_factory=dict, description="topic to evidence level: 'mentioned' | 'basic' | 'implementation' | 'deep' | 'strongly_verified'")
    weak_topics:       list[str]        = Field(default=[], description="weak technical topics identified")
    strong_topics:     list[str]        = Field(default=[], description="strong technical topics identified")

class gen_followup_ques_schema(BaseModel):
    current_question: str = Field(default="", description="targeted professional follow-up question")

# class final_report_schema(BaseModel):
#     overall_performance_rating: str       = Field(default="", description="Excellent/Good/Average/Below Average")
#     hiring_recommendation:      str       = Field(default="", description="Strongly Recommend/Recommend/Neutral/Do Not Recommend")
#     average_score:              float     = Field(default=0.0, description="average technical score out of 10")
#     total_percentage:           float     = Field(default=0.0, description="total percentage scored")
#     strong_topics:              list[str] = Field(default=[], description="strong topic areas demonstrated")
#     weak_topics:                list[str] = Field(default=[], description="weak topic areas demonstrated")
#     critical_missing_skills:    list[str] = Field(default=[], description="skills in JD but missing in candidate")
#     communication_evaluation:   str       = Field(default="", description="assessment of fluency, vocabulary, and clarity based on transcript and speaking metrics")
#     jd_alignment_score:         int       = Field(default=0, description="0 to 100 JD match score")
#     final_verdict:              str       = Field(default="", description="2-3 sentence objective assessment")
#     what_candidate_knows:       str       = Field(default="", description="1 crisp sentence summarizing what technical domain and core concepts the candidate demonstrated solid knowledge of")
#     strong_parts_summary:       str       = Field(default="", description="1 short line summarizing candidate's top strong technical parts")
#     weak_parts_summary:         str       = Field(default="", description="1 short line summarizing candidate's primary weak technical parts or gaps")
#     executive_summary:          str       = Field(default="", description="2-3 crisp sentences providing top executive overview of candidate performance relative to Job Description")
#     jd_matched_skills:          list[str] = Field(default=[], description="skills demonstrated by candidate that directly match the core requirements in the Job Description")
#     jd_relevant_projects:       list[str] = Field(default=[], description="bullet points detailing candidate projects/experience evaluated during interview that directly relate to Job Description requirements")
from pydantic import BaseModel, Field
from typing import Literal


class FinalReportSchema(BaseModel):

    # =========================
    # OVERALL PERFORMANCE
    # =========================

    overall_performance_rating: Literal[
        "Excellent",
        "Good",
        "Average",
        "Below Average"
    ] = Field(
        default="Average",
        description="Overall technical interview performance based only on demonstrated evidence."
    )

    hiring_recommendation: Literal[
        "Strongly Recommend",
        "Recommend",
        "Neutral",
        "Do Not Recommend"
    ] = Field(
        default="Neutral",
        description="Hiring recommendation based on technical performance, JD alignment, communication, and demonstrated evidence."
    )

    average_score: float = Field(
        default=0.0,
        ge=0,
        le=10,
        description="Average technical score calculated from individual interview question scores."
    )

    total_percentage: float = Field(
        default=0.0,
        ge=0,
        le=100,
        description="Average technical score converted to percentage."
    )

    # =========================
    # TECHNICAL STRENGTHS
    # =========================

    strong_topics: list[str] = Field(
        default_factory=list,
        description="Technical topics where the candidate demonstrated correct and sufficiently detailed understanding."
    )

    weak_topics: list[str] = Field(
        default_factory=list,
        description="Technical topics where the candidate demonstrated incorrect, incomplete, shallow, or uncertain understanding."
    )

    # =========================
    # JD ANALYSIS
    # =========================

    jd_alignment_score: int = Field(
        default=0,
        ge=0,
        le=100,
        description="Evidence-based alignment between demonstrated candidate capabilities and the Job Description."
    )

    jd_matched_skills: list[str] = Field(
        default_factory=list,
        description="JD-required skills that were explicitly demonstrated by the candidate during the interview."
    )

    critical_missing_skills: list[str] = Field(
        default_factory=list,
        description="Important JD-required skills that were not demonstrated or were demonstrated inadequately."
    )

    jd_relevant_projects: list[str] = Field(
        default_factory=list,
        description="Candidate projects or experience explicitly discussed in the interview that are relevant to JD requirements."
    )

    # =========================
    # COMMUNICATION
    # =========================

    communication_evaluation: str = Field(
        default="",
        description="Evidence-based assessment of clarity, fluency, vocabulary, structure, and ability to explain technical concepts."
    )

    # =========================
    # CANDIDATE KNOWLEDGE
    # =========================

    what_candidate_knows: str = Field(
        default="",
        description="One concise sentence describing the technical areas the candidate demonstrably understands."
    )

    strong_parts_summary: str = Field(
        default="",
        description="One concise sentence summarizing the candidate's strongest demonstrated technical areas."
    )

    weak_parts_summary: str = Field(
        default="",
        description="One concise sentence summarizing the candidate's most important technical gaps."
    )

    # =========================
    # EXECUTIVE SUMMARY
    # =========================

    executive_summary: str = Field(
        default="",
        description="2-3 concise sentences summarizing demonstrated technical ability, JD alignment, strengths, and major gaps."
    )

    final_verdict: str = Field(
        default="",
        description="2-3 sentence evidence-based final assessment. Do not introduce facts not present in the interview data."
    )

# Alias for backwards compatibility
final_report_schema = FinalReportSchema

def safe_chain_invoke(llm, parser, prompt, fallback_factory):
    raw_text = None
    try:
        chain_raw = llm | cleaner
        raw_text = chain_raw.invoke(prompt)
    except Exception as e:
        print(f"[SafeInvoke] Primary LLM invocation failed: {e}")
        api_key = getattr(settings, "GROQ_API_KEY", None) or os.getenv("GROQ_API_KEY")
        fallback_models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "deepseek-r1-distill-llama-70b"]
        for fb_model in fallback_models:
            try:
                print(f"[SafeInvoke] Attempting fallback model: {fb_model}")
                fb_llm = ChatGroq(model=fb_model, api_key=api_key, temperature=0.2)
                fb_chain = fb_llm | cleaner
                raw_text = fb_chain.invoke(prompt)
                print(f"[SafeInvoke] Fallback model {fb_model} succeeded")
                break
            except Exception as fb_err:
                print(f"[SafeInvoke] Fallback model {fb_model} failed: {fb_err}")

    if not raw_text:
        print("[SafeInvoke] All LLM invocation attempts failed, returning fallback object.")
        return fallback_factory()

    try:
        return parser.parse(raw_text)
    except Exception as parse_err:
        print(f"[SafeInvoke] Pydantic parser failed, attempting manual JSON parse: {parse_err}")
        
    try:
        import json
        clean_text = clean_llm_output(raw_text)
        data = json.loads(clean_text)
        pydantic_class = parser.pydantic_object
        
        kwargs = {}
        for name, field in pydantic_class.model_fields.items():
            default = field.default if not field.is_required() else None
            val = data.get(name, default)
            if name == "scores" and isinstance(val, list):
                scores_mapped = []
                for s in val:
                    if isinstance(s, dict):
                        scores_mapped.append(ScoreEntry(
                            question=s.get("question", ""),
                            score=s.get("score", 0),
                            evaluation=s.get("evaluation", "")
                        ))
                kwargs[name] = scores_mapped
            else:
                kwargs[name] = val
            
        return pydantic_class(**kwargs)
    except Exception as fallback_err:
        print(f"[SafeInvoke] Manual parsing failed: {fallback_err}")
        return fallback_factory()


# ── InterviewState Definition ────────────────────────────────────
class InterviewState(TypedDict):
    resume_text:           str
    job_description:       dict
    candidate_skills:      list[str]
    candidate_experience:  list[str]
    candidate_project:     list[str]
    user_profile_data:     dict
    interview_context:     str
    conversation:          Annotated[list, add_messages]
    covered_topics:        list[str]
    concept_evidence:      dict[str, str]
    current_question:      str
    current_answer:        str
    question_count:        int
    max_questions:         int
    max_followups:         int
    scores:                list[str]
    needs_followup:        bool
    followup_question:     str
    weak_topics:           list[str]
    strong_topics:         list[str]
    custom_questions:      list[str]
    tool_response:         str
    tool_call_count:       bool
    interview_phase:       Literal["setup", "greeting", "asking", "evaluating", "followup", "next_question", "finished"]
    followup_count:        int
    final_report:          str
    speaking_scores:       list[dict]
    report_avg_fluency:    float
    report_avg_ttr:        float
    report_filler_ratio:   float
    report_vocab_level:    str
    report_speaking_notes: str
    report_rating:         str
    report_recommendation: str
    report_avg_score:      float
    report_percentage:     float
    report_strong_topics:  list[str]
    report_weak_topics:    list[str]
    report_missing_skills: list[str]
    report_verdict:        str


# ── Speaking skill scorer ────────────────────────────────────────
def score_speaking_skill(state: InterviewState) -> dict:
    scores             = analyze_speaking(state["current_answer"])
    scores["question"] = state["current_question"]

    existing   = state.get("speaking_scores") or []
    all_scores = existing + [scores]

    fluencies    = [s["fluency_score"] for s in all_scores if s.get("fluency_score")]
    ttrs         = [s["ttr"]           for s in all_scores if s.get("ttr")]
    filler_rats  = [s["filler_ratio"]  for s in all_scores if s.get("filler_ratio") is not None]
    vocab_levels = [s["vocab_level"]   for s in all_scores if s.get("vocab_level")]

    avg_fluency = round(sum(fluencies)   / len(fluencies),   1) if fluencies   else 0.0
    avg_ttr     = round(sum(ttrs)        / len(ttrs),        3) if ttrs        else 0.0
    avg_filler  = round(sum(filler_rats) / len(filler_rats), 1) if filler_rats else 0.0
    vocab_level = Counter(vocab_levels).most_common(1)[0][0]    if vocab_levels else "N/A"

    return {
        "speaking_scores":     all_scores,
        "report_avg_fluency":  avg_fluency,
        "report_avg_ttr":      avg_ttr,
        "report_filler_ratio": avg_filler,
        "report_vocab_level":  vocab_level,
    }


# ── LangGraph Nodes ──────────────────────────────────────────────

def resume_parsing(state: InterviewState) -> dict:
    llm    = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(pydantic_object=get_resume_schema)
    prompt = f"""
You are an expert technical resume analyst. Analyze the resume and extract structured candidate information.
Resume:
{state['resume_text']}

Extract:
1. candidate_skills - Technical skills, programming languages, frameworks, databases, cloud, tools.
2. candidate_experience - Format: "Role | Company | Duration | Key responsibilities"
3. candidate_project - Format: "Project Name | Tech Stack | Personal implementation & claims"

Treat all resume entries as claims to be technically verified during the interview.

CRITICAL RULES:
- Return ONLY a raw JSON object.
- Do NOT use ```json or ``` wrappers.
- Your entire response must start with {{ and end with }}

{parser.get_format_instructions()}
"""
    result = safe_chain_invoke(
        llm, parser, prompt,
        fallback_factory=lambda: get_resume_schema(candidate_skills=[], candidate_experience=[], candidate_project=[])
    )

    skills = result.candidate_skills or []
    exp = result.candidate_experience or []
    proj = result.candidate_project or []

    user_prof = state.get("user_profile_data") or {}
    if not skills and user_prof.get("skills"):
        prof_skills = user_prof.get("skills")
        skills = prof_skills if isinstance(prof_skills, list) else [str(prof_skills)]
    if not exp and user_prof.get("experience"):
        prof_exp = user_prof.get("experience")
        exp = [str(x) for x in prof_exp] if isinstance(prof_exp, list) else [str(prof_exp)]
    if not proj and user_prof.get("projects"):
        prof_proj = user_prof.get("projects")
        proj = [str(p) for p in prof_proj] if isinstance(prof_proj, list) else [str(prof_proj)]

    return {
        "candidate_skills":     skills,
        "candidate_experience": exp,
        "candidate_project":    proj,
    }


def introduce_and_greet(state: InterviewState) -> dict:
    llm = get_interview_llm()

    job_title = (
        state["job_description"].get("title")
        or state["job_description"].get("role")
        or "the position"
    )
    max_q = state["max_questions"]
    est_time = max_q * 3

    prompt = f"""You are a senior, highly professional technical interviewer at an enterprise technology organization.

Candidate Application Role: {job_title}

Write a concise, highly professional, neutral, and confident technical introduction.

MANDATORY PERSONA GUIDELINES:
1. Greet the candidate professionally and state your role as the AI Technical Interviewer.
2. State the target position being evaluated: {job_title}.
3. Explain that the technical assessment consists of approximately {max_q} primary technical focus areas and will take around {est_time} minutes.
4. Invite the candidate to provide a brief professional overview of their technical background and key experience.
5. Tone MUST be serious, professional, polite, neutral, and concise (2-3 sentences max).
6. DO NOT use emojis, casual language ("buddy", "awesome", "great job", "let's have fun"), or over-enthusiasm.
7. Write plain text only.
"""

    try:
        response = llm.invoke(prompt)
        greeting = response.content.strip()
    except Exception as e:
        print(f"[introduce_and_greet] LLM invocation failed: {e}")
        greeting = f"Hello. I am your AI technical interviewer today. We will be conducting a technical evaluation for the {job_title} position. The assessment consists of {max_q} key technical focus areas and will take approximately {est_time} minutes. To begin, please provide a brief overview of your technical background and relevant experience."

    return {
        "current_question": greeting,
        "interview_phase":  "greeting",
        "conversation":     [AIMessage(content=greeting)],
    }


def collect_intro(state: InterviewState) -> dict:
    answer = interrupt({"question": state["current_question"]})
    if not answer or answer.strip() == "":
        answer = "The candidate did not provide a self-introduction."
    return {
        "current_answer": answer,
        "conversation":   state["conversation"] + [HumanMessage(content=answer)],
        "interview_context": answer,
    }


def generate_question(state: InterviewState) -> dict:
    llm    = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(pydantic_object=get_question_gen_schema)

    # Clean recruiter questions if provided; gracefully empty list if not
    raw_cq = state.get("custom_questions") or []
    clean_cq = [q.strip() for q in raw_cq if isinstance(q, str) and q.strip()]

    recruiter_prompt = ""
    unasked_cq = [q for q in clean_cq if f"recruiter_q:{q}" not in state.get("covered_topics", [])]
    if unasked_cq and (state["question_count"] % 2 == 1 or len(unasked_cq) >= (state["max_questions"] - state["question_count"])):
        target_cq = unasked_cq[0]
        recruiter_prompt = f"RECRUITER MANDATORY QUESTION TO INCLUDE: Ask or adapt this recruiter-defined question: '{target_cq}'"

    transition_hint = ""
    if state["question_count"] == 0:
        transition_hint = (
            "This is the FIRST technical question. Start with a neutral, professional transition sentence "
            "(e.g. 'Thank you for your introduction. Let's begin the technical evaluation.') followed immediately by the first question."
        )
    else:
        transition_hint = (
            "Include a clean, professional transition (e.g., 'Thank you. Let's move to the next area.', "
            "'Now I would like to focus on...', or 'Let's examine your implementation of...')."
        )

    prompt = f"""You are an expert, professional technical interviewer. You conduct dynamic, adaptive technical interviews.

INTERVIEWER PERSONA & TONE RULES:
- Tone: Professional, polite, confident, serious, neutral, clear, slightly authoritative, concise.
- NEVER use casual fluff or emojis (NO "Great job!", "Awesome!", "Don't worry", "Tell me more, buddy").
- NEVER give away whether previous answers were right or wrong during the interview.
- Phrasing: Ask ONE clear, single primary question at a time. Do NOT ask multi-part compound questions.

CURRENT CONTEXT & EVIDENCE TRACKER:
- Target Job Description: {state["job_description"]}
- Candidate Resume Skills: {state["candidate_skills"]}
- Candidate Experience: {state["candidate_experience"]}
- Candidate Projects: {state["candidate_project"]}
- Candidate Intro: {state.get("interview_context", "")}
- Topics Covered & Evidence Levels: {state.get("concept_evidence", {})}
- List of Covered Topics: {state.get("covered_topics", [])}
- Current Question Index: {state["question_count"] + 1} of {state["max_questions"]}
{recruiter_prompt}

CRITICAL DYNAMIC QUESTION SELECTION RULES:
1. DO NOT ask generic introductory questions. Establish actual technical ability immediately on primary JD requirements.
2. Treat candidate resume claims as claims requiring technical verification (verify personal contribution, architecture, technical decisions, trade-offs, deployment, performance, edge cases).
3. DO NOT repeat concepts already covered or demonstrated. If a concept has reached 'implementation' or 'deep' evidence level, move to an UNCOVERED JD requirement or unverified resume claim.
4. Adapt difficulty dynamically: if candidate showed strong understanding, explore architecture, system design, or trade-offs; if struggling, assess core fundamentals without repeating identical questions.
5. Keep the question concise (1-2 sentences maximum).

{transition_hint}

CRITICAL FORMAT RULES:
- Return ONLY a raw JSON object.
- Do NOT use ```json or ``` wrappers.
- Your entire response must start with {{ and end with }}

{parser.get_format_instructions()}
"""
    result = safe_chain_invoke(
        llm, parser, prompt,
        fallback_factory=lambda: get_question_gen_schema(
            current_question="Thank you. Could you explain the technical architecture of your primary project and the specific backend responsibilities you handled?",
            covered_topics=["project_architecture"]
        )
    )
    return {
        "current_question": result.current_question,
        "conversation":     [AIMessage(content=result.current_question)],
        "covered_topics":   state["covered_topics"] + result.covered_topics,
        "question_count":   state["question_count"] + 1,
        "interview_phase":  "asking",
        "needs_followup":   False,
        "followup_count":   0,
    }


def ask_human(state: InterviewState) -> dict:
    answer = interrupt({"question": state["current_question"]})
    if not answer or answer.strip() == "":
        return {"current_answer": "The candidate provided no response."}
    return {"current_answer": answer}


def ask_followup_human(state: InterviewState) -> dict:
    answer = interrupt({"question": state["current_question"]})
    if not answer or answer.strip() == "":
        return {"current_answer": "The candidate provided no response."}
    return {"current_answer": answer}


def evaluate_response(state: InterviewState) -> dict:
    llm    = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(pydantic_object=get_evaluate_schema)

    is_final = state["question_count"] >= state["max_questions"]
    max_followups = state.get("max_followups")
    if max_followups is None:
        max_followups = state.get("job_description", {}).get("max_followups", 2)
    max_followups = int(max_followups)

    prompt = f"""You are a senior, professional technical interviewer evaluating a candidate's answer.

INTERVIEWER PERSONA & EVALUATION RULES:
- Evaluate candidate answer strictly based on technical accuracy, depth, clarity, and evidence.
- Distinguish evidence levels: 'mentioned', 'basic', 'implementation', 'deep', 'strongly_verified'.
- Set needs_followup=True ONLY IF the answer is incomplete, ambiguous, superficial, technically interesting requiring deeper verification, or reveals an important gap.
- Set needs_followup=False IF the answer demonstrates clear, solid understanding OR if the topic has been sufficiently verified.
- DO NOT generate follow-up questions just because an answer exists. If understanding is demonstrated, move forward to a new topic.
- Neutrality: Maintain professional neutrality without live grade comments ("Great job", "Incorrect", "8/10").

EVALUATION INPUTS:
- Question Asked: {state["current_question"]}
- Candidate Answer: {state["current_answer"]}
- Conversation Transcript:
{format_conversation(state.get("conversation", []))}
- Job Description: {state["job_description"]}
- Resume Background: {state["candidate_skills"]} | {state["candidate_project"]}
- Current Follow-up Count: {state["followup_count"]} (Max Allowed: {max_followups})
- Is Final Question: {is_final}

INSTRUCTIONS FOR NEXT QUESTION GENERATION:
- If needs_followup is True and follow-up budget remains (Current Follow-up Count < {max_followups}): generate a concise, targeted follow-up question digging deeper into candidate's implementation details, trade-offs, or gap.
- If needs_followup is False or follow-up budget reached (Current Follow-up Count >= {max_followups}): generate a NEW question on an UNCOVERED topic from the Job Description / Resume claims.
- Transition Style: Professional & Neutral ("Thank you. Let's explore that implementation further." or "Thank you. Let's move to the next area.").

CRITICAL FORMAT RULES:
- Return ONLY a raw JSON object.
- Do NOT use ```json or ``` wrappers.
- Your entire response must start with {{ and end with }}

{parser.get_format_instructions()}
"""
    result = safe_chain_invoke(
        llm, parser, prompt,
        fallback_factory=lambda: get_evaluate_schema(
            scores=[ScoreEntry(question=state["current_question"], score=5, evaluation="Evaluated response.")],
            needs_followup=False,
            next_question="Thank you. Let's move to database optimization and query design.",
            topic_covered=["database_optimization"],
            concept_evidence={"database_optimization": "basic"},
            weak_topics=[],
            strong_topics=[]
        )
    )
    new_scores = [
        f"Q: {s.question} | Score: {s.score}/10 | {s.evaluation}"
        for s in result.scores
    ]

    needs_followup = result.needs_followup
    followup_count = state["followup_count"]
    question_count = state["question_count"]

    if needs_followup and followup_count >= max_followups:
        needs_followup = False

    if is_final:
        needs_followup = False

    if needs_followup:
        followup_count += 1
        phase = "followup"
    else:
        followup_count = 0
        if not is_final:
            question_count += 1
        phase = "asking"

    next_q = result.next_question.strip() if not is_final else ""
    topic_covered = result.topic_covered

    existing_evidence = state.get("concept_evidence") or {}
    new_evidence = result.concept_evidence if hasattr(result, "concept_evidence") and isinstance(result.concept_evidence, dict) else {}
    merged_evidence = {**existing_evidence, **new_evidence}

    update = {
        "scores":           state["scores"] + new_scores,
        "weak_topics":      state["weak_topics"]   + result.weak_topics,
        "strong_topics":    state["strong_topics"] + result.strong_topics,
        "needs_followup":   needs_followup,
        "followup_count":   followup_count,
        "question_count":   question_count,
        "current_question": next_q,
        "interview_phase":  "finished" if is_final else phase,
        "covered_topics":   state["covered_topics"] + topic_covered,
        "concept_evidence": merged_evidence,
    }

    msgs = [HumanMessage(content=state["current_answer"])]
    if next_q:
        msgs.append(AIMessage(content=next_q))
    update["conversation"] = state["conversation"] + msgs

    return update


def generate_followup(state: InterviewState) -> dict:
    llm    = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(pydantic_object=gen_followup_ques_schema)
    prompt = f"""You are a professional technical interviewer asking a follow-up question.

INTERVIEWER PERSONA & TONE:
- Professional, polite, confident, serious, neutral, concise.
- NO friendly slang, emojis, or casual talk ("Got it buddy", "Awesome", "Great job").
- Use professional transitions ("I'd like to explore that implementation further.", "Let me examine your rationale for that choice.", "Could you elaborate on the technical trade-offs of that approach?").

Context:
- Previous Question: {state["current_question"]}
- Candidate's Answer: {state["current_answer"]}
- Identified Gaps/Weakness: {state["weak_topics"]}

Instructions:
1. Target the specific ambiguity, incomplete implementation detail, or technical gap in the candidate's previous answer.
2. Ask ONE concise, single follow-up question (1-2 sentences).
3. Do not switch topics.

CRITICAL FORMAT RULES:
- Return ONLY a raw JSON object.
- Do NOT use ```json or ``` wrappers.
- Your entire response must start with {{ and end with }}

{parser.get_format_instructions()}
"""
    result = safe_chain_invoke(
        llm, parser, prompt,
        fallback_factory=lambda: gen_followup_ques_schema(current_question="")
    )
    question = result.current_question.strip()
    if not question:
        last_weak = state["weak_topics"][-1] if state["weak_topics"] else "that technical area"
        question  = f"Thank you. Could you elaborate further on your implementation details regarding {last_weak}?"
    return {
        "current_question": question,
        "followup_count":   state["followup_count"] + 1,
        "interview_phase":  "followup",
    }


# def generate_final_report(state: InterviewState) -> dict:
#   llm    = get_interview_llm(json_mode=True)
#     parser = PydanticOutputParser(pydantic_object=final_report_schema)
    
#     avg_fluency = state.get("report_avg_fluency", 0.0)
#     vocab_level = state.get("report_vocab_level", "N/A")
#     filler_ratio = state.get("report_filler_ratio", 0.0)
    
#     full_transcript = format_conversation(state.get("conversation", []))

#     prompt = f"""You are generating a strict, 100% factual final interview report as a senior technical evaluator.

# CRITICAL FOCUS ON JD RELEVANCE (SKILLS & PROJECTS):
# 1. MAJOR FOCUS ON SKILLS & PROJECTS RELEVANT TO THE JOB DESCRIPTION:
#    - Identify candidate's technical skills that directly fulfill key Job Description (JD) requirements (jd_matched_skills).
#    - Evaluate candidate's projects and past experience discussed in the interview that align with the JD requirements (jd_relevant_projects). Note whether project claims and tech stacks were verified in spoken answers.
#    - List critical skills required by the JD that the candidate failed to demonstrate or lacked (critical_missing_skills).
# 2. Base your evaluation strictly on what the candidate actually said in the transcript.
# 3. Keep descriptions concise, crisp, short, and executive-level.

# Candidate Spoken Transcript:
# {full_transcript}

# Interview Telemetry & Metrics:
# - Total Questions Asked: {state["question_count"]}
# - Scores Per Question: {state["scores"]}
# - Concept Evidence Map: {state.get("concept_evidence", {})}
# - Strong Topics Logged: {state["strong_topics"]}
# - Weak Topics Logged: {state["weak_topics"]}
# - Target Job Description: {state["job_description"]}
# - Candidate Resume Skills & Projects: {state["candidate_skills"]} | {state.get("candidate_project", [])}

# Speaking Metrics:
# - Average Fluency Score: {avg_fluency} / 10
# - Vocabulary Tier: {vocab_level}
# - Average Filler Ratio: {filler_ratio}%
                                          
# Instructions — SHORT, CLEAR & JD-FOCUSED EVALUATION:
# 1. executive_summary: A concise 2-3 sentence overview covering overall candidate fit for the JD.
# 2. overall_performance_rating: Excellent / Good / Average / Below Average
# 3. hiring_recommendation: Strongly Recommend / Recommend / Neutral / Do Not Recommend
# 4. average_score: average technical score out of 10
# 5. total_percentage: (average_score / 10 * 100)
# 6. jd_alignment_score: Integer 0 to 100 evaluating candidate's overall demonstrated alignment with Job Description requirements.
# 7. jd_matched_skills: Concise list of candidate skills demonstrated that directly match JD requirements.
# 8. jd_relevant_projects: Concise list of candidate projects/experience discussed that directly relate to JD tasks & stack.
# 9. strong_topics: concise list of top technical strengths demonstrated.
# 10. weak_topics: concise list of key technical weaknesses/gaps.
# 11. critical_missing_skills: required skills in JD missing in candidate answers.
# 12. communication_evaluation: A concise 1-2 sentence assessment of candidate verbal expression.
# 13. final_verdict: Crisp 2-sentence objective assessment.
# 14. what_candidate_knows: 1 crisp sentence summarizing core domain knowledge.
# 15. strong_parts_summary: 1 short phrase summarizing top strengths.
# 16. weak_parts_summary: 1 short phrase summarizing primary gaps.

# CRITICAL RULES:
# - Return ONLY a raw JSON object.
# - Do NOT use ```json or ``` wrappers.
# - Your entire response must start with {{ and end with }}

# {parser.get_format_instructions()}
# """
#     result = safe_chain_invoke(
#         llm, parser, prompt,
#         fallback_factory=lambda: final_report_schema(
#             overall_performance_rating="Average",
#             hiring_recommendation="Neutral",
#             average_score=5.0,
#             total_percentage=50.0,
#             strong_topics=[],
#             weak_topics=[],
#             critical_missing_skills=[],
#             communication_evaluation="Candidate demonstrated intermediate fluency and vocabulary control.",
#             jd_alignment_score=50,
#             final_verdict="The evaluation report generation was completed using baseline metrics.",
#             what_candidate_knows="Demonstrated foundational software development concepts.",
#             strong_parts_summary="Basic foundational understanding.",
#             weak_parts_summary="Needs depth in advanced technical topics.",
#             executive_summary="Candidate demonstrated foundational skills corresponding to the target role.",
#             jd_matched_skills=[],
#             jd_relevant_projects=[]
#         )
#     )
    
#     qa_blocks = []
#     temp_q = None
#     seen_messages = set()
#     for msg in state.get("conversation", []):
#         content = (msg.content if hasattr(msg, "content") else str(msg)).strip()
#         if not content:
#             continue
#         msg_key = (msg.__class__.__name__, content)
#         if msg_key in seen_messages:
#             continue
#         seen_messages.add(msg_key)
        
#         is_ai = isinstance(msg, AIMessage) or (hasattr(msg, "type") and msg.type == "ai")
#         is_human = isinstance(msg, HumanMessage) or (hasattr(msg, "type") and msg.type == "human")
#         if is_ai:
#             temp_q = content
#         elif is_human:
#             if temp_q:
#                 qa_blocks.append(f"❓ **Question**: {temp_q}\n\n💬 **Answer**: *\"{content}\"*")
#                 temp_q = None
#             else:
#                 qa_blocks.append(f"💬 **Candidate**: *\"{content}\"*")
#     if temp_q:
#         qa_blocks.append(f"❓ **Question**: {temp_q}\n\n💬 **Answer**: *(No answer recorded)*")
    
#     qa_transcript = "\n\n---\n\n".join(qa_blocks) if qa_blocks else "No Q&A transcript recorded."

#     rec = (result.hiring_recommendation or "").strip().lower()
#     rating = (result.overall_performance_rating or "").strip().lower()
#     avg_score = result.average_score

#     if rec in ["strongly recommend", "recommend"] or rating in ["excellent", "good"] or avg_score >= 6.0:
#         qualification_status = "✅ QUALIFIED FOR THIS ROUND"
#         ability_summary = "Candidate holds the required technical ability, domain knowledge, and core competencies for this role."
#     elif rec == "neutral" or avg_score >= 4.5:
#         qualification_status = "⚠️ POTENTIALLY QUALIFIED / UNDER REVIEW"
#         ability_summary = "Candidate demonstrates baseline technical ability, but exhibits minor gaps requiring additional technical evaluation."
#     else:
#         qualification_status = "❌ NOT QUALIFIED THIS ROUND"
#         ability_summary = "Candidate currently does not demonstrate sufficient technical proficiency or role-alignment required for this round."

#     knows_text = (getattr(result, "what_candidate_knows", "") or "").strip()
#     if not knows_text:
#         knows_text = f"Demonstrated technical understanding of {', '.join(result.strong_topics[:3])}" if result.strong_topics else "Demonstrates functional understanding of core technical fundamentals."

#     strong_text = (getattr(result, "strong_parts_summary", "") or "").strip()
#     if not strong_text:
#         strong_text = ", ".join(result.strong_topics) if result.strong_topics else "Solid general baseline understanding."

#     weak_text = (getattr(result, "weak_parts_summary", "") or "").strip()
#     if not weak_text:
#         weak_text = ", ".join(result.weak_topics) if result.weak_topics else "No critical weaknesses identified."

#     exec_summary = (getattr(result, "executive_summary", "") or "").strip()
#     if not exec_summary:
#         exec_summary = f"Candidate evaluated for target role with a JD alignment score of {result.jd_alignment_score}/100 and overall performance rating of {result.overall_performance_rating}."

#     matched_skills = getattr(result, "jd_matched_skills", []) or []
#     matched_skills_text = "\n".join([f"- {s}" for s in matched_skills]) if matched_skills else "- Candidate skills match core foundational requirements."

#     relevant_projects = getattr(result, "jd_relevant_projects", []) or []
#     relevant_projects_text = "\n".join([f"- {p}" for p in relevant_projects]) if relevant_projects else "- Evaluated project experience demonstrated functional tech stack alignment."

#     formatted = f"""### 📋 Executive Assessment & Candidate Evaluation

# #### 📌 Executive Summary
# {exec_summary}

# ---

# #### 🎯 Round Qualification & Capability Decision
# * **Qualification Status**: **{qualification_status}**
# * **Role Ability Assessment**: {ability_summary}
# * **Overall Technical Rating**: {result.overall_performance_rating}
# * **Hiring Recommendation**: {result.hiring_recommendation}
# * **Average Technical Score**: {result.average_score:.1f} / 10
# * **ATS & Technical Match**: {result.total_percentage:.1f}%
# * **Job Description Alignment Score**: {result.jd_alignment_score} / 100

# ---

# #### 🎯 Job Description Alignment — Key Skills & Projects Focus

# ##### 🛠️ JD-Relevant Skills Demonstrated:
# {matched_skills_text}

# ##### 📁 JD-Relevant Projects & Experience Evaluated:
# {relevant_projects_text}

# ##### 🚫 Missing Required JD Skills:
# {chr(10).join([f'- {skill}' for skill in result.critical_missing_skills]) if result.critical_missing_skills else '- No critical skills missing.'}

# ---

# #### ⚡ Technical Strengths & Gaps Snapshot
# * 🧠 **What Candidate Knows**: {knows_text}
# * 🌟 **Strong Parts**: {strong_text}
# * ⚠️ **Weak Parts**: {weak_text}

# #### 🌟 Technical Strengths (Detailed)
# {chr(10).join([f'- {topic}' for topic in result.strong_topics]) if result.strong_topics else '- No significant strength areas identified.'}

# #### ⚠️ Areas for Improvement (Detailed)
# {chr(10).join([f'- {topic}' for topic in result.weak_topics]) if result.weak_topics else '- No critical weaknesses identified.'}

# ---

# #### 💬 Verbal Communication
# {result.communication_evaluation}

# ---

# #### ⚖️ Final Verdict
# {result.final_verdict}

# ---

# ### 📝 Technical Interview Transcript (Questions & Answers)

# {qa_transcript}
# """

#     return {
#         "final_report":          formatted,
#         "interview_phase":       "finished",
#         "report_rating":         result.overall_performance_rating,
#         "report_recommendation": result.hiring_recommendation,
#         "report_avg_score":      result.average_score,
#         "report_percentage":     result.total_percentage,
#         "report_strong_topics":  result.strong_topics,
#         "report_weak_topics":    result.weak_topics,
#         "report_missing_skills": result.critical_missing_skills,
#         "report_verdict":        result.final_verdict,
#     }




def generate_final_report(state: InterviewState) -> dict:
    """
    Generate a concise but complete final interview performance report.

    Design:
    - Python handles deterministic calculations.
    - LLM handles qualitative/evidence-based evaluation.
    - No artificial/default candidate assessment is generated.
    - Final report contains only information useful for evaluating performance.
    """

    llm = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(
        pydantic_object=FinalReportSchema
    )

    # ============================================================
    # 1. COLLECT INTERVIEW DATA
    # ============================================================

    conversation = state.get("conversation", [])

    full_transcript = format_conversation(conversation)

    question_count = state.get("question_count", 0)

    scores = state.get("scores", [])

    strong_topics_logged = state.get("strong_topics", []) or []
    weak_topics_logged = state.get("weak_topics", []) or []

    concept_evidence = state.get("concept_evidence", {}) or {}

    job_description = state.get("job_description", "")

    candidate_skills = state.get("candidate_skills", []) or []

    candidate_projects = state.get("candidate_project", []) or []

    # ============================================================
    # 2. SPEAKING METRICS
    # ============================================================

    avg_fluency = state.get("report_avg_fluency", 0.0)
    vocab_level = state.get("report_vocab_level", "N/A")
    filler_ratio = state.get("report_filler_ratio", 0.0)

    # ============================================================
    # 3. CALCULATE REAL TECHNICAL SCORE
    # ============================================================

    valid_scores = []

    for score in scores:
        try:
            numeric_score = float(score)

            if 0 <= numeric_score <= 10:
                valid_scores.append(numeric_score)

        except (TypeError, ValueError):
            continue

    calculated_average_score = (
        round(sum(valid_scores) / len(valid_scores), 2)
        if valid_scores
        else None
    )

    calculated_percentage = (
        round(calculated_average_score * 10, 2)
        if calculated_average_score is not None
        else None
    )

    # ============================================================
    # 4. PROMPT FOR LLM
    # ============================================================

    prompt = f"""
You are a senior technical interviewer generating a concise,
evidence-based final interview performance report.

Your job is to evaluate the candidate ONLY from the information
provided below.

============================================================
CANDIDATE INTERVIEW TRANSCRIPT
============================================================

{full_transcript}

============================================================
INTERVIEW DATA
============================================================

Total Questions:
{question_count}

Question Scores:
{scores}

Concept Evidence:
{concept_evidence}

Recorded Strong Topics:
{strong_topics_logged}

Recorded Weak Topics:
{weak_topics_logged}

============================================================
JOB DESCRIPTION
============================================================

{job_description}

============================================================
CANDIDATE RESUME INFORMATION
============================================================

Skills:
{candidate_skills}

Projects:
{candidate_projects}

============================================================
COMMUNICATION METRICS
============================================================

Average Fluency:
{avg_fluency}/10

Vocabulary Level:
{vocab_level}

Average Filler Ratio:
{filler_ratio}%

============================================================
YOUR EVALUATION TASK
============================================================

Generate a SHORT but COMPLETE final performance assessment.

The report must be sufficient for a recruiter/interviewer to
understand the candidate's performance without reading the
entire interview transcript.

Evaluate the following:

1. overall_performance_rating
   - Excellent
   - Good
   - Average
   - Below Average

2. hiring_recommendation
   - Strongly Recommend
   - Recommend
   - Neutral
   - Do Not Recommend

3. average_score
   Use the actual calculated interview score when available.
   Do NOT invent a score.

4. total_percentage
   This must correspond to the technical score.

5. strong_topics
   Include only technical topics where the candidate actually
   demonstrated understanding.

6. weak_topics
   Include only areas where the candidate demonstrated
   incorrect, incomplete, shallow, or uncertain understanding.

7. critical_missing_skills
   Include important JD requirements that were not demonstrated.
   Do NOT assume a candidate lacks a skill merely because it was
   not asked about.

8. communication_evaluation
   Give a concise assessment based on the communication metrics
   and actual candidate answers.

9. jd_alignment_score
   Give a 0-100 score based on demonstrated alignment with the JD.
   Do not give credit merely because a skill appears in the resume.

10. jd_matched_skills
    Include skills that:
    - are relevant to the JD
    - AND were actually demonstrated during the interview.

11. jd_relevant_projects
    Include only projects/experience that:
    - were actually discussed
    - AND are relevant to the JD.

12. what_candidate_knows
    One concise sentence describing the candidate's demonstrated
    technical knowledge.

13. strong_parts_summary
    One concise sentence describing the strongest areas.

14. weak_parts_summary
    One concise sentence describing the most important gaps.

15. executive_summary
    2-3 concise sentences covering:
    - overall performance
    - technical strengths
    - important gaps
    - JD alignment

16. final_verdict
    2 concise sentences summarizing the final evidence-based
    assessment.

============================================================
STRICT EVIDENCE RULES
============================================================

1. NEVER invent skills, projects, technologies, certifications,
   experience, or knowledge.

2. NEVER treat resume claims as proof of technical proficiency.

3. Resume information may identify claimed experience, but spoken
   interview answers determine demonstrated knowledge.

4. Do not infer expertise from a keyword mention.

5. Every strong topic must be supported by candidate answers.

6. Every weak topic must be supported by an actual weakness,
   incorrect answer, incomplete explanation, or uncertainty.

7. Do not treat silence as proof that the candidate lacks a skill.

8. If a JD skill was not tested, do not automatically classify it
   as missing.

9. Use "not demonstrated" reasoning internally when evidence is
   insufficient.

10. Do not create generic statements such as:
    - "Basic foundational understanding."
    - "Solid general baseline understanding."
    - "Demonstrated functional tech stack alignment."
    - "No critical weaknesses identified."

11. If evidence is insufficient for a field, return an empty list
    or a concise evidence-limitation statement.

12. Keep all lists concise. Prefer the most important 3-6 items.

13. Do not repeat the same information across multiple fields.

14. The final report must be concise and recruiter-friendly.

15. Do not include the complete transcript in the final answer.

============================================================
IMPORTANT SCORE RULE
============================================================

The actual technical average calculated by Python is:

{calculated_average_score}

The actual percentage calculated by Python is:

{calculated_percentage}

If these values are available, use them exactly.

Do not independently invent different values.

============================================================

Return ONLY a valid JSON object.

{parser.get_format_instructions()}
"""

    # ============================================================
    # 5. DATA-BASED FALLBACK
    # ============================================================

    def create_fallback_report():

        if calculated_average_score is None:
            fallback_rating = "Average"
            fallback_recommendation = "Neutral"
            fallback_percentage = 0.0

            score_text = "Insufficient scoring data"
            verdict_text = (
                "A complete qualitative evaluation could not be generated "
                "because sufficient interview scoring data was unavailable."
            )

        else:
            fallback_percentage = calculated_percentage

            if calculated_average_score >= 8:
                fallback_rating = "Excellent"
                fallback_recommendation = "Strongly Recommend"

            elif calculated_average_score >= 6.5:
                fallback_rating = "Good"
                fallback_recommendation = "Recommend"

            elif calculated_average_score >= 5:
                fallback_rating = "Average"
                fallback_recommendation = "Neutral"

            else:
                fallback_rating = "Below Average"
                fallback_recommendation = "Do Not Recommend"

            score_text = (
                f"{calculated_average_score:.2f}/10 "
                f"({calculated_percentage:.1f}%)"
            )

            verdict_text = (
                f"The candidate achieved an average technical score of "
                f"{score_text}. "
                "A detailed qualitative assessment was unavailable."
            )

        # Use only topics already recorded by the interview system.
        fallback_strong_topics = list(strong_topics_logged)

        fallback_weak_topics = list(weak_topics_logged)

        strong_summary = (
            ", ".join(fallback_strong_topics[:3])
            if fallback_strong_topics
            else "No specific technical strengths were recorded."
        )

        weak_summary = (
            ", ".join(fallback_weak_topics[:3])
            if fallback_weak_topics
            else "No specific technical weaknesses were recorded."
        )

        what_candidate_knows = (
            f"Demonstrated knowledge in {', '.join(fallback_strong_topics[:3])}."
            if fallback_strong_topics
            else
            "Insufficient evidence to identify specific technical strengths."
        )

        executive_summary = (
            f"Technical performance: {score_text}. "
            f"Key strengths: {strong_summary}. "
            f"Key gaps: {weak_summary}."
        )

        communication_summary = (
            f"Fluency: {avg_fluency}/10; "
            f"vocabulary: {vocab_level}; "
            f"average filler ratio: {filler_ratio}%."
        )

        return FinalReportSchema(
            overall_performance_rating=fallback_rating,

            hiring_recommendation=fallback_recommendation,

            average_score=(
                calculated_average_score
                if calculated_average_score is not None
                else 0.0
            ),

            total_percentage=(
                fallback_percentage
                if fallback_percentage is not None
                else 0.0
            ),

            strong_topics=fallback_strong_topics,

            weak_topics=fallback_weak_topics,

            critical_missing_skills=[],

            communication_evaluation=communication_summary,

            jd_alignment_score=0,

            final_verdict=verdict_text,

            what_candidate_knows=what_candidate_knows,

            strong_parts_summary=strong_summary,

            weak_parts_summary=weak_summary,

            executive_summary=executive_summary,

            jd_matched_skills=[],

            jd_relevant_projects=[]
        )

    # ============================================================
    # 6. RUN LLM EVALUATION
    # ============================================================

    result = safe_chain_invoke(
        llm,
        parser,
        prompt,
        fallback_factory=create_fallback_report
    )

    # ============================================================
    # 7. PROTECT DETERMINISTIC SCORE VALUES
    # ============================================================

    if calculated_average_score is not None:
        result.average_score = calculated_average_score
        result.total_percentage = calculated_percentage

    # ============================================================
    # 8. CLEAN / NORMALIZE LISTS
    # ============================================================

    result.strong_topics = [
        str(item).strip()
        for item in (result.strong_topics or [])
        if str(item).strip()
    ]

    result.weak_topics = [
        str(item).strip()
        for item in (result.weak_topics or [])
        if str(item).strip()
    ]

    result.critical_missing_skills = [
        str(item).strip()
        for item in (result.critical_missing_skills or [])
        if str(item).strip()
    ]

    result.jd_matched_skills = [
        str(item).strip()
        for item in (result.jd_matched_skills or [])
        if str(item).strip()
    ]

    result.jd_relevant_projects = [
        str(item).strip()
        for item in (result.jd_relevant_projects or [])
        if str(item).strip()
    ]

    # ============================================================
    # 9. LIMIT REPORT SIZE
    # ============================================================

    result.strong_topics = result.strong_topics[:6]
    result.weak_topics = result.weak_topics[:6]
    result.critical_missing_skills = result.critical_missing_skills[:6]
    result.jd_matched_skills = result.jd_matched_skills[:8]
    result.jd_relevant_projects = result.jd_relevant_projects[:5]

    # ============================================================
    # 10. SAFE TEXT FALLBACKS
    # ============================================================

    knows_text = (
        result.what_candidate_knows or
        "Insufficient evidence to identify specific technical knowledge."
    ).strip()

    strong_text = (
        result.strong_parts_summary or
        (
            ", ".join(result.strong_topics[:3])
            if result.strong_topics
            else "No specific technical strengths identified."
        )
    ).strip()

    weak_text = (
        result.weak_parts_summary or
        (
            ", ".join(result.weak_topics[:3])
            if result.weak_topics
            else "No specific technical weaknesses identified."
        )
    ).strip()

    exec_summary = (
        result.executive_summary or
        (
            f"Candidate achieved an average technical score of "
            f"{result.average_score:.1f}/10 with a JD alignment score of "
            f"{result.jd_alignment_score}/100."
        )
    ).strip()

    communication_text = (
        result.communication_evaluation or
        f"Fluency: {avg_fluency}/10; "
        f"vocabulary: {vocab_level}; "
        f"filler ratio: {filler_ratio}%."
    ).strip()

    verdict_text = (
        result.final_verdict or
        "Insufficient evidence to generate a detailed final assessment."
    ).strip()

    # ============================================================
    # 11. DETERMINE ROUND STATUS
    # ============================================================

    avg_score = result.average_score
    jd_score = result.jd_alignment_score

    if avg_score >= 8 and jd_score >= 75:

        qualification_status = "STRONG MATCH"

        ability_summary = (
            "Strong demonstrated technical performance with clear "
            "alignment to the role requirements."
        )

    elif avg_score >= 6.5 and jd_score >= 60:

        qualification_status = "MATCH"

        ability_summary = (
            "Demonstrated sufficient technical ability and relevant "
            "alignment with the role."
        )

    elif avg_score >= 5 and jd_score >= 45:

        qualification_status = "BORDERLINE MATCH"

        ability_summary = (
            "Demonstrates some relevant capability, but additional "
            "evaluation may be required for important gaps."
        )

    else:

        qualification_status = "LOW MATCH"

        ability_summary = (
            "The interview evidence shows limited technical performance "
            "or limited demonstrated alignment with the role."
        )

    # ============================================================
    # 12. PREPARE COMPACT LISTS
    # ============================================================

    matched_skills_text = (
        "\n".join(
            f"- {skill}"
            for skill in result.jd_matched_skills
        )
        if result.jd_matched_skills
        else "- None sufficiently demonstrated."
    )

    relevant_projects_text = (
        "\n".join(
            f"- {project}"
            for project in result.jd_relevant_projects
        )
        if result.jd_relevant_projects
        else "- No JD-relevant project evidence identified."
    )

    missing_skills_text = (
        "\n".join(
            f"- {skill}"
            for skill in result.critical_missing_skills
        )
        if result.critical_missing_skills
        else "- No critical missing skills identified from the tested areas."
    )

    strong_topics_text = (
        "\n".join(
            f"- {topic}"
            for topic in result.strong_topics
        )
        if result.strong_topics
        else "- None specifically identified."
    )

    weak_topics_text = (
        "\n".join(
            f"- {topic}"
            for topic in result.weak_topics
        )
        if result.weak_topics
        else "- None specifically identified."
    )

    # ============================================================
    # 13. BUILD CONCISE FINAL REPORT
    # ============================================================

    formatted = f"""### 📋 Interview Performance Report

#### 📌 Executive Summary
{exec_summary}

---

### 🎯 Overall Performance

| Metric | Result |
|---|---|
| **Overall Rating** | **{result.overall_performance_rating}** |
| **Technical Score** | **{result.average_score:.1f} / 10** |
| **Technical Percentage** | **{result.total_percentage:.1f}%** |
| **JD Alignment** | **{result.jd_alignment_score} / 100** |
| **Hiring Recommendation** | **{result.hiring_recommendation}** |
| **Round Status** | **{qualification_status}** |

**Role Ability:** {ability_summary}

---

### 🛠️ Technical Assessment

**What Candidate Knows:**  
{knows_text}

**Strong Areas:**
{strong_topics_text}

**Weak Areas:**
{weak_topics_text}

---

### 🎯 JD Alignment

**Matched Skills:**
{matched_skills_text}

**Relevant Projects / Experience:**
{relevant_projects_text}

**Important Missing / Not Demonstrated Skills:**
{missing_skills_text}

---

### 💬 Communication

{communication_text}

---

### ⚖️ Final Verdict

{verdict_text}
"""

    # ============================================================
    # 14. RETURN STATE
    # ============================================================

    return {
        "final_report": formatted,

        "interview_phase": "finished",

        "report_rating":
            result.overall_performance_rating,

        "report_recommendation":
            result.hiring_recommendation,

        "report_avg_score":
            result.average_score,

        "report_percentage":
            result.total_percentage,

        "report_strong_topics":
            result.strong_topics,

        "report_weak_topics":
            result.weak_topics,

        "report_missing_skills":
            result.critical_missing_skills,

        "report_verdict":
            result.final_verdict,
    }




# ── Routers ──────────────────────────────────────────────────────
def route_after_evaluation(state: InterviewState) -> str:
    if state["question_count"] >= state["max_questions"] and not state["needs_followup"]:
        return "finished"
    return "next"


# ── LangGraph Architecture ───────────────────────────────────────
def build_interview_graph():
    graph = StateGraph(InterviewState)

    graph.add_node("resume_parsing",        resume_parsing)
    graph.add_node("introduce_and_greet",   introduce_and_greet)
    graph.add_node("collect_intro",         collect_intro)
    graph.add_node("generate_question",     generate_question)
    graph.add_node("ask_human",             ask_human)
    graph.add_node("evaluate_response",     evaluate_response)
    graph.add_node("score_speaking_skill",  score_speaking_skill)
    graph.add_node("generate_final_report", generate_final_report)

    graph.set_entry_point("resume_parsing")

    graph.add_edge("resume_parsing",      "introduce_and_greet")
    graph.add_edge("introduce_and_greet", "collect_intro")
    graph.add_edge("collect_intro",       "generate_question")
    graph.add_edge("generate_question",   "ask_human")

    graph.add_edge("ask_human",           "evaluate_response")
    graph.add_edge("evaluate_response",   "score_speaking_skill")

    graph.add_conditional_edges(
        "score_speaking_skill",
        route_after_evaluation,
        {"next": "ask_human", "finished": "generate_final_report"},
    )

    graph.add_edge("generate_final_report", END)
    return graph


# ── State Graph Singleton ────────────────────────────────────────
_memory = MemorySaver()
_app    = None

def get_interview_app():
    global _app
    if _app is None:
        _app = build_interview_graph().compile(checkpointer=_memory)
    return _app


# ── Initial State Template ───────────────────────────────────────
INITIAL_STATE_TEMPLATE = {
    "candidate_skills":      [],
    "candidate_experience":  [],
    "candidate_project":     [],
    "user_profile_data":     {},
    "conversation":          [],
    "covered_topics":        [],
    "concept_evidence":      {},
    "current_question":      "",
    "current_answer":        "",
    "interview_context":     "",
    "question_count":        0,
    "scores":                [],
    "needs_followup":        False,
    "followup_question":     "",
    "weak_topics":           [],
    "strong_topics":         [],
    "tool_response":         "",
    "tool_call_count":       False,
    "interview_phase":       "setup",
    "followup_count":        0,
    "final_report":          "",
    "speaking_scores":       [],
    "report_avg_fluency":    0.0,
    "report_avg_ttr":        0.0,
    "report_filler_ratio":   0.0,
    "report_vocab_level":    "N/A",
    "report_speaking_notes": "",
    "report_rating":         "",
    "report_recommendation": "",
    "report_avg_score":      0.0,
    "report_percentage":     0.0,
    "report_strong_topics":  [],
    "report_weak_topics":    [],
    "report_missing_skills": [],
    "report_verdict":        "",
    "custom_questions":      [],
    "max_followups":         2,
}


# ── Session Helpers ──────────────────────────────────────────────
def create_interview_session(resume_text: str, job_description: dict, max_questions: int = 5, custom_questions: list = None, max_followups: int = 2, user_profile_data: dict = None) -> str:
    app       = get_interview_app()
    thread_id = str(uuid.uuid4())
    config    = {"configurable": {"thread_id": thread_id}}

    cq = custom_questions or []
    if isinstance(cq, str):
        cq = [q.strip() for q in cq.split("\n") if q.strip()]

    if isinstance(job_description, dict) and job_description.get("max_followups") is not None:
        try:
            max_followups = int(job_description["max_followups"])
        except (ValueError, TypeError):
            pass

    initial_state = {
        **INITIAL_STATE_TEMPLATE,
        "resume_text":       resume_text,
        "job_description":   job_description,
        "max_questions":     max(max_questions, len(cq) + 1) if cq else max_questions,
        "custom_questions":   cq,
        "max_followups":     max_followups,
        "user_profile_data": user_profile_data or {},
    }

    for _ in app.stream(initial_state, config=config, stream_mode="values"):
        pass

    return thread_id


def get_current_question(thread_id: str) -> dict:
    app      = get_interview_app()
    config   = {"configurable": {"thread_id": thread_id}}
    snapshot = app.get_state(config)
    values   = snapshot.values
    return {
        "question":       values.get("current_question", ""),
        "phase":          values.get("interview_phase", ""),
        "question_count": values.get("question_count", 0),
        "max_questions":  values.get("max_questions", 0),
        "followup_count": values.get("followup_count", 0),
        "final_report":   values.get("final_report", ""),
        "report": {
            "rating":          values.get("report_rating", ""),
            "recommendation":  values.get("report_recommendation", ""),
            "avg_score":       values.get("report_avg_score", 0.0),
            "percentage":      values.get("report_percentage", 0.0),
            "strong_topics":   values.get("report_strong_topics", []),
            "weak_topics":     values.get("report_weak_topics", []),
            "missing_skills":  values.get("report_missing_skills", []),
            "verdict":         values.get("report_verdict", ""),
            "avg_fluency":     values.get("report_avg_fluency", 0.0),
            "avg_ttr":         values.get("report_avg_ttr", 0.0),
            "filler_ratio":    values.get("report_filler_ratio", 0.0),
            "vocab_level":     values.get("report_vocab_level", "N/A"),
            "speaking_scores": values.get("speaking_scores", []),
        },
    }


def submit_answer(thread_id: str, answer: str) -> dict:
    from langgraph.types import Command
    app    = get_interview_app()
    config = {"configurable": {"thread_id": thread_id}}

    for _ in app.stream(Command(resume=answer), config=config, stream_mode="values"):
        pass

    return get_current_question(thread_id)