"""
Interview LangGraph Service
"""
import re, uuid, os
from collections import Counter
from typing import Annotated, Literal, TypedDict
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

# ── LLM ───────────────────────────────────────────────────────
_llm_cache = {}

def get_interview_llm(json_mode: bool = False):
    global _llm_cache
    if json_mode not in _llm_cache:
        api_key = getattr(settings, "GROQ_API_KEY", None) or os.getenv("GROQ_API_KEY")
        kwargs = {}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        _llm_cache[json_mode] = ChatGroq(
            model="qwen/qwen3.6-27b",
            api_key=api_key,
            temperature=0.2,
            **kwargs
        )
    return _llm_cache[json_mode]


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


# ── JSON Cleaner ───────────────────────────────────────────────
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


# ── Schemas ────────────────────────────────────────────────────
class get_resume_schema(BaseModel):
    candidate_skills:     list[str] = Field(default=[], description="stores skills of candidate")
    candidate_experience: list[str] = Field(default=[], description="stores experience of candidate")
    candidate_project:    list[str] = Field(default=[], description="stores project of candidate")

class get_question_gen_schema(BaseModel):
    current_question: str      = Field(default="", description="stores current question")
    covered_topics:   list[str] = Field(default_factory=list, description="stores all covered topics")

class ScoreEntry(BaseModel):
    question:   str = Field(default="", description="the question that was asked")
    score:      int = Field(default=0,  description="score out of 10")
    evaluation: str = Field(default="", description="brief evaluation comment")

class get_evaluate_schema(BaseModel):
    scores:            list[ScoreEntry] = Field(default=[], description="scores per answer")
    needs_followup:    bool             = Field(default=False, description="whether follow-up is needed")
    next_question:     str              = Field(default="", description="the next question to ask. If needs_followup is True, this MUST be a follow-up question digging deeper into their previous answer. If needs_followup is False, this MUST be a new question on a different topic from the Job Description / candidate skills that has not been covered yet.")
    topic_covered:     list[str]        = Field(default_factory=list, description="the specific technical topic(s) covered by this next question to add to covered_topics")
    weak_topics:       list[str]        = Field(default=[], description="weak topics")
    strong_topics:     list[str]        = Field(default=[], description="strong topics")

class gen_followup_ques_schema(BaseModel):
    current_question: str = Field(default="", description="stores the followup question")

class final_report_schema(BaseModel):
    overall_performance_rating: str       = Field(default="", description="Excellent/Good/Average/Below Average")
    hiring_recommendation:      str       = Field(default="", description="Strongly Recommend/Recommend/Neutral/Do Not Recommend")
    average_score:              float     = Field(default=0.0, description="average score out of 10")
    total_percentage:           float     = Field(default=0.0, description="total percentage scored")
    strong_topics:              list[str] = Field(default=[], description="strong topic areas")
    weak_topics:                list[str] = Field(default=[], description="weak topic areas")
    critical_missing_skills:    list[str] = Field(default=[], description="skills in JD but missing in candidate")
    communication_evaluation:   str       = Field(default="", description="A clear, structured assessment (2-3 sentences) evaluating the candidate's verbal communication skills, including fluency, vocabulary command, and use of filler words, synthesized from the provided speaking metrics.")
    jd_alignment_score:         int       = Field(default=0, description="An integer from 0 to 100 evaluating how well the candidate performed and demonstrated competency specifically in the skills, experience, and responsibilities outlined in the Job Description.")
    final_verdict:              str       = Field(default="", description="2-3 sentence assessment")


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
        print(f"[SafeInvoke] LLM invocation failed: {e}")
        return fallback_factory()

    # 2. Try parsing with Pydantic parser
    try:
        return parser.parse(raw_text)
    except Exception as parse_err:
        print(f"[SafeInvoke] Pydantic parser failed, attempting manual JSON parse: {parse_err}")
        
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
            # Support ScoreEntry mapping if evaluating
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


# ── InterviewState ─────────────────────────────────────────────
class InterviewState(TypedDict):
    resume_text:           str
    job_description:       dict
    candidate_skills:      list[str]
    candidate_experience:  list[str]
    candidate_project:     list[str]
    interview_context:     str
    conversation:          Annotated[list, add_messages]
    covered_topics:        list[str]
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


# ── Speaking skill scorer ──────────────────────────────────────
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


# ── Nodes ──────────────────────────────────────────────────────

def resume_parsing(state: InterviewState) -> dict:
    llm    = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(pydantic_object=get_resume_schema)
    chain  = llm | cleaner | parser
    prompt = f"""
You are an expert resume parser. Analyze the resume and extract candidate information.
Resume:
{state['resume_text']}

Extract:
1. candidate_skills - List technical skills, languages, frameworks, tools, databases, cloud platforms.
2. candidate_experience - Format: "Role | Company | Duration | Key responsibilities"
3. candidate_project - Format: "Project Name | Technologies Used | Brief Description"

CRITICAL RULES:
- Return ONLY a raw JSON object.
- Do NOT write any Python code.
- Do NOT include explanation, markdown, or text outside the JSON.
- Do NOT use ```json or ``` wrappers.
- Your entire response must start with {{ and end with }}

{parser.get_format_instructions()}
"""
    result = safe_chain_invoke(
        llm, parser, prompt,
        fallback_factory=lambda: get_resume_schema(candidate_skills=[], candidate_experience=[], candidate_project=[])
    )
    return {
        "candidate_skills":     result.candidate_skills,
        "candidate_experience": result.candidate_experience,
        "candidate_project":    result.candidate_project,
    }


def introduce_and_greet(state: InterviewState) -> dict:
    """
    Shlok introduces himself warmly, shares what the session will cover,
    and invites the candidate to introduce themselves.
    The greeting is generated by the LLM so it feels natural each time.
    """
    llm = get_interview_llm()

    job_title = (
        state["job_description"].get("title")
        or state["job_description"].get("role")
        or "the position"
    )
  

    prompt = f"""You are Shlok, professional technical interviewer at a top tech company.

The candidate has applied for: {job_title}

Write a short, warm, human introduction as Shlok. It should:
1. Greet the candidate and introduce yourself as Shlok.
2. mention the role they applied for.
3. Explain that the interview will have {state['max_questions']} technical questions and should take about {state['max_questions'] * 3}-{state['max_questions'] * 5} minutes and can go bit longer depends on your performance.
4. Ask him for introduction
Keep it conversational, concise (2-3 sentences max). Do NOT use bullet points. Write in plain text only.
"""

    response = llm.invoke(prompt)
    greeting = response.content.strip()

    return {
        "current_question": greeting,
        "interview_phase":  "greeting",
        "conversation":     [AIMessage(content=greeting)],
    }


def collect_intro(state: InterviewState) -> dict:
    """Interrupt to capture the candidate's self-introduction."""
    answer = interrupt({"question": state["current_question"]})
    if not answer or answer.strip() == "":
        answer = "The candidate did not provide an introduction."
    return {
        "current_answer": answer,
        "conversation":   state["conversation"] + [HumanMessage(content=answer)],
        "interview_context": answer,   # store intro as context for personalising questions
    }


def generate_question(state: InterviewState) -> dict:
    llm    = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(pydantic_object=get_question_gen_schema)
    chain  = llm | cleaner | parser

    # First technical question gets a warmer transition from Shlok
    transition_hint = ""
    if state["question_count"] == 0:
        transition_hint = (
            "Since this is the FIRST technical question, begin with a brief, "
            "friendly transition sentence from Shlok (e.g. 'Great, thanks for sharing that! "
            "Let's dive into the technical side now.') and then ask the question. "
            "Include both the transition and question together in current_question."
        )

    prompt = f"""You are Shlok, an expert technical interviewer. You speak in a warm, conversational tone.
Conversation History:
{format_conversation(state["conversation"])}
Candidate Introduction / Context: {state.get("interview_context", "")}
Job Description: {state["job_description"]}
Candidate Skills: {state["candidate_skills"]}
Candidate Experience: {state["candidate_experience"]}
Candidate Projects: {state["candidate_project"]}
{transition_hint}

Instructions:
1. Analyze the conversation and identify topics already covered.
2. Generate ONE new interview question that:
   * Is relevant to the job description.
   * Is NOT a repeat of previously covered topics: {state["covered_topics"]}.
   * Matches the candidate's experience level.
   * Explores skill gaps between candidate skills and JD requirements.
   * Is phrased naturally, as Shlok would ask it in a real interview (not robotic).
   * Is concise (1-2 sentences).
3. Update covered_topics with all previous topics plus the new topic.

CRITICAL RULES:
- Return ONLY a raw JSON object.
- Do NOT use ```json or ``` wrappers.
- Your entire response must start with {{ and end with }}

{parser.get_format_instructions()}
"""
    result = safe_chain_invoke(
        llm, parser, prompt,
        fallback_factory=lambda: get_question_gen_schema(
            current_question="Could you describe one of your projects and the technologies you used?",
            covered_topics=[]
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
        return {"current_answer": "i dont know the answer"}
    return {"current_answer": answer}


def ask_followup_human(state: InterviewState) -> dict:
    answer = interrupt({"question": state["current_question"]})
    if not answer or answer.strip() == "":
        return {"current_answer": "i dont know the answer"}
    return {"current_answer": answer}


def evaluate_response(state: InterviewState) -> dict:
    llm    = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(pydantic_object=get_evaluate_schema)
    chain  = llm | cleaner | parser

    is_final = state["question_count"] >= state["max_questions"]
    max_followups = state.get("max_followups", 2)

    final_instruction = ""
    if is_final:
        final_instruction = (
            "CRITICAL: This is the final question of the interview. The candidate's response completes the interview. "
            "Therefore, you MUST set needs_followup to False, set next_question to an empty string, and return an empty topic_covered list."
        )
    else:
        final_instruction = (
            f"Limit of follow-ups is {max_followups} per main question. The current follow-up count is {state['followup_count']}. "
            f"If the current follow-up count is {max_followups}, you MUST set needs_followup to False and ask a new question on a different topic.\n"
            f"Topics already covered so far: {state['covered_topics']}.\n"
            "If needs_followup is False, generate a new question on a different topic, relevant to the Job Description / candidate skills, and add the topic name to topic_covered."
        )

    prompt = f"""You are Shlok, an expert technical interviewer and evaluator.
Interview Context:
{format_conversation(state["conversation"])}
Current Question: {state["current_question"]}
Candidate Answer: {state["current_answer"]}
Job Description: {state["job_description"]}
Candidate Skills: {state["candidate_skills"]}
Candidate Experience: {state["candidate_experience"]}
Candidate Projects: {state["candidate_project"]}

Evaluation Guidelines:
1. Score 1-10: 9-10 Excellent, 7-8 Good, 5-6 Partial, 3-4 Weak, 1-2 Incorrect.
2. Set needs_followup=True if the answer is vague, incomplete, or needs more depth.
3. Set needs_followup=False if the answer demonstrates clear conceptual understanding.
4. Keep the JSON field 'evaluation' extremely brief and concise (1 short sentence maximum).
5. Keep the JSON field 'next_question' very concise (1-2 sentences maximum).

{final_instruction}

CRITICAL RULES:
- Return ONLY a raw JSON object.
- Do NOT use ```json or ``` wrappers.
- Your entire response must start with {{ and end with }}

{parser.get_format_instructions()}
"""
    result = safe_chain_invoke(
        llm, parser, prompt,
        fallback_factory=lambda: get_evaluate_schema(
            scores=[ScoreEntry(question=state["current_question"], score=5, evaluation="Parsed fallback score due to JSON error.")],
            needs_followup=False,
            next_question="Could you explain another technical project you worked on recently?",
            topic_covered=["projects"],
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
    custom_qs = state.get("custom_questions", [])
    if not is_final and not needs_followup and custom_qs:
        import random
        # Select a random unasked custom question from the recruiter's list
        unasked = [q for q in custom_qs if f"custom_q:{q}" not in state["covered_topics"]]
        if unasked:
            next_q = random.choice(unasked)
            topic_covered = [f"custom_q:{next_q}"]
        else:
            next_q = result.next_question.strip() if not is_final else ""
            topic_covered = result.topic_covered
    else:
        next_q = result.next_question.strip() if not is_final else ""
        topic_covered = result.topic_covered

    update = {
        "scores":          state["scores"] + new_scores,
        "weak_topics":     state["weak_topics"]   + result.weak_topics,
        "strong_topics":   state["strong_topics"] + result.strong_topics,
        "needs_followup":  needs_followup,
        "followup_count":  followup_count,
        "question_count":  question_count,
        "current_question": next_q,
        "interview_phase": "finished" if is_final else phase,
        "covered_topics":   state["covered_topics"] + topic_covered,
    }

    msgs = [HumanMessage(content=state["current_answer"])]
    if next_q:
        msgs.append(AIMessage(content=next_q))
    update["conversation"] = state["conversation"] + msgs

    return update


def generate_followup(state: InterviewState) -> dict:
    llm    = get_interview_llm()
    parser = PydanticOutputParser(pydantic_object=gen_followup_ques_schema)
    chain  = llm | cleaner | parser
    prompt = f"""You are Shlok, a friendly and expert technical interviewer.
Generate a follow-up question based on the candidate's previous answer.

Conversation History: {state["conversation"]}
Previous Question: {state["current_question"]}
Candidate's Answer: {state["current_answer"]}
Weak Topics Identified: {state["weak_topics"]}

Instructions:
1. Analyze the candidate's answer carefully.
2. Generate ONE follow-up question targeting the biggest weakness.
3. Phrase it naturally as Shlok would — e.g. start with "Got it, let me ask you a bit more about that..." 
   or "Interesting! Can you dig deeper into..." to keep the conversation flowing.
4. Keep it concise (1-2 sentences), progressively deeper.
5. Do not ask a completely new topic.

CRITICAL RULES:
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
        last_weak = state["weak_topics"][-1] if state["weak_topics"] else "that topic"
        question  = f"Interesting! Could you dig a bit deeper into {last_weak}? I'd love to hear more."
    return {
        "current_question": question,
        "followup_count":   state["followup_count"] + 1,
        "interview_phase":  "followup",
    }


def generate_final_report(state: InterviewState) -> dict:
    llm    = get_interview_llm(json_mode=True)
    parser = PydanticOutputParser(pydantic_object=final_report_schema)
    chain  = llm | cleaner | parser
    
    # Gather communication metrics from state
    avg_fluency = state.get("report_avg_fluency", 0.0)
    vocab_level = state.get("report_vocab_level", "N/A")
    filler_ratio = state.get("report_filler_ratio", 0.0)
    
    prompt = f"""You are Shlok generating a concise final interview report.

Interview Data:
- Total Questions Asked: {state["question_count"]}
- Scores Per Question: {state["scores"]}
- Strong Topics: {state["strong_topics"]}
- Weak Topics: {state["weak_topics"]}
- Job Description: {state["job_description"]}
- Candidate Skills: {state["candidate_skills"]}

Candidate Verbal Communication & Speaking Metrics:
- Average Fluency Score: {avg_fluency} / 10
- Vocabulary Tier: {vocab_level}
- Average Filler Words Ratio: {filler_ratio}%

Instructions — SHORT and CONCISE evaluation:
1. overall_performance_rating: Excellent / Good / Average / Below Average
2. hiring_recommendation: Strongly Recommend / Recommend / Neutral / Do Not Recommend
3. average_score: average of all scores out of 10
4. total_percentage: (average_score / 10 * 100)
5. strong_topics: top strong areas
6. weak_topics: key weak areas
7. critical_missing_skills: skills in JD not demonstrated
8. communication_evaluation: A clear, structured assessment (2-3 sentences) summarizing the candidate's verbal communication skill, fluency, vocabulary command, and usage/overuse of filler words, synthesized accurately from the provided speaking metrics. Do not just restate the raw parameters; explain what they mean for the candidate's communication level.
9. jd_alignment_score: An integer from 0 to 100 evaluating how well the candidate's performance, answers, and demonstrated technical competency aligned specifically with the requirements outlined in the Job Description.
10. final_verdict: 2-3 sentences assessment only

CRITICAL RULES:
- Return ONLY a raw JSON object.
- Do NOT use ```json or ``` wrappers.
- Your entire response must start with {{ and end with }}

{parser.get_format_instructions()}
"""
    result = safe_chain_invoke(
        llm, parser, prompt,
        fallback_factory=lambda: final_report_schema(
            overall_performance_rating="Average",
            hiring_recommendation="Neutral",
            average_score=5.0,
            total_percentage=50.0,
            strong_topics=[],
            weak_topics=[],
            critical_missing_skills=[],
            communication_evaluation="Fluency and vocabulary are within intermediate range with standard filler usage.",
            jd_alignment_score=50,
            final_verdict="The evaluation report generation failed to parse correctly. Standard fallback applied."
        )
    )
    
    # Extract and format the interview Q&A transcript from conversation history
    qa_blocks = []
    temp_q = None
    seen_messages = set()
    for msg in state.get("conversation", []):
        content = (msg.content if hasattr(msg, "content") else str(msg)).strip()
        if not content:
            continue
        msg_key = (msg.__class__.__name__, content)
        if msg_key in seen_messages:
            continue
        seen_messages.add(msg_key)
        
        is_ai = isinstance(msg, AIMessage) or (hasattr(msg, "type") and msg.type == "ai")
        is_human = isinstance(msg, HumanMessage) or (hasattr(msg, "type") and msg.type == "human")
        if is_ai:
            temp_q = content
        elif is_human:
            if temp_q:
                qa_blocks.append(f"❓ **Question**: {temp_q}\n\n💬 **Answer**: *\"{content}\"*")
                temp_q = None
            else:
                qa_blocks.append(f"💬 **Candidate**: *\"{content}\"*")
    if temp_q:
        qa_blocks.append(f"❓ **Question**: {temp_q}\n\n💬 **Answer**: *(No answer recorded)*")
    
    qa_transcript = "\n\n---\n\n".join(qa_blocks) if qa_blocks else "No Q&A transcript recorded."

    # Format the report beautifully using clean markdown
    formatted = f"""### 📋 Interview Evaluation Report

* **Overall Rating**: {result.overall_performance_rating}
* **Hiring Recommendation**: {result.hiring_recommendation}
* **Average Technical Score**: {result.average_score:.1f} / 10
* **ATS & Technical Match**: {result.total_percentage:.1f}%
* **Job Description Alignment Score**: {result.jd_alignment_score} / 100

---

#### 🌟 Technical Strength Areas
{chr(10).join([f'- {topic}' for topic in result.strong_topics]) if result.strong_topics else '- No significant strength areas identified.'}

#### ⚠️ Areas for Improvement
{chr(10).join([f'- {topic}' for topic in result.weak_topics]) if result.weak_topics else '- No critical weaknesses identified.'}

#### 🚫 Critical Missing Skills (from Job Requirements)
{chr(10).join([f'- {skill}' for skill in result.critical_missing_skills]) if result.critical_missing_skills else '- No critical skills missing.'}

---

#### 💬 Verbal Communication & Expression Assessment
{result.communication_evaluation}

---

#### ⚖️ Final Verdict
{result.final_verdict}

---

#### 📝 Interview Transcript (Questions & Answers)
{qa_transcript}
"""

    return {
        "final_report":          formatted,
        "interview_phase":       "finished",
        "report_rating":         result.overall_performance_rating,
        "report_recommendation": result.hiring_recommendation,
        "report_avg_score":      result.average_score,
        "report_percentage":     result.total_percentage,
        "report_strong_topics":  result.strong_topics,
        "report_weak_topics":    result.weak_topics,
        "report_missing_skills": result.critical_missing_skills,
        "report_verdict":        result.final_verdict,
    }


# ── Routers ────────────────────────────────────────────────────
def route_after_evaluation(state: InterviewState) -> str:
    if state["question_count"] >= state["max_questions"] and not state["needs_followup"]:
        return "finished"
    return "next"


# ── Graph ──────────────────────────────────────────────────────
def build_interview_graph():
    graph = StateGraph(InterviewState)

    # ── Nodes ──
    graph.add_node("resume_parsing",        resume_parsing)
    graph.add_node("introduce_and_greet",   introduce_and_greet)
    graph.add_node("collect_intro",         collect_intro)
    graph.add_node("generate_question",     generate_question)
    graph.add_node("ask_human",             ask_human)
    graph.add_node("evaluate_response",     evaluate_response)
    graph.add_node("score_speaking_skill",  score_speaking_skill)
    graph.add_node("generate_final_report", generate_final_report)

    # ── Entry ──
    graph.set_entry_point("resume_parsing")

    # ── Greeting flow ──
    graph.add_edge("resume_parsing",      "introduce_and_greet")
    graph.add_edge("introduce_and_greet", "collect_intro")
    graph.add_edge("collect_intro",       "generate_question")
    graph.add_edge("generate_question",   "ask_human")

    # ── Main interview loop ──
    graph.add_edge("ask_human",           "evaluate_response")
    graph.add_edge("evaluate_response",   "score_speaking_skill")

    graph.add_conditional_edges(
        "score_speaking_skill",
        route_after_evaluation,
        {"next": "ask_human", "finished": "generate_final_report"},
    )

    graph.add_edge("generate_final_report", END)
    return graph


# ── Singleton ──────────────────────────────────────────────────
_memory = MemorySaver()
_app    = None

def get_interview_app():
    global _app
    if _app is None:
        _app = build_interview_graph().compile(checkpointer=_memory)
    return _app


# ── Initial state template ─────────────────────────────────────
INITIAL_STATE_TEMPLATE = {
    "candidate_skills":      [],
    "candidate_experience":  [],
    "candidate_project":     [],
    "conversation":          [],
    "covered_topics":        [],
    "current_question":      "",
    "current_answer":        "",
    "interview_context":     "",       # NEW — stores candidate's self-intro
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


# ── Session helpers ────────────────────────────────────────────
def create_interview_session(resume_text: str, job_description: dict, max_questions: int = 5, custom_questions: list = None, max_followups: int = 2) -> str:
    app       = get_interview_app()
    thread_id = str(uuid.uuid4())
    config    = {"configurable": {"thread_id": thread_id}}

    cq = custom_questions or []
    initial_state = {
        **INITIAL_STATE_TEMPLATE,
        "resume_text":     resume_text,
        "job_description": job_description,
        "max_questions":   max(max_questions, len(cq) + 1) if cq else max_questions,
        "custom_questions": cq,
        "max_followups":   max_followups,
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






# Interview LangGraph Service
# """
# import re, uuid
# from collections import Counter
# from typing import Annotated, Literal, TypedDict
# from pydantic import BaseModel, Field
# from langchain_core.output_parsers import PydanticOutputParser
# from langchain_core.runnables import RunnableLambda
# from langchain_core.messages import HumanMessage, AIMessage
# from langchain_groq import ChatGroq
# from langgraph.graph import StateGraph, END
# from langgraph.graph.message import add_messages
# from langgraph.checkpoint.memory import MemorySaver
# from langgraph.types import interrupt
# from .voice_analyzer import analyze_speaking


# # ── LLM ───────────────────────────────────────────────────────
# def get_interview_llm():
#     return ChatGroq(
#         model="llama-3.1-8b-instant",
#         api_key="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",
#     )


# # ── JSON Cleaner ───────────────────────────────────────────────
# def clean_llm_output(message):
#     text = message.content if hasattr(message, "content") else str(message)
#     json_block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
#     if json_block:
#         return json_block.group(1)
#     start = text.find("{")
#     end   = text.rfind("}")
#     if start != -1 and end != -1:
#         return text[start:end + 1]
#     return text

# cleaner = RunnableLambda(clean_llm_output)


# # ── Schemas ────────────────────────────────────────────────────
# class get_resume_schema(BaseModel):
#     candidate_skills:     list[str] = Field(default=[], description="stores skills of candidate")
#     candidate_experience: list[str] = Field(default=[], description="stores experience of candidate")
#     candidate_project:    list[str] = Field(default=[], description="stores project of candidate")

# class get_question_gen_schema(BaseModel):
#     current_question: str     = Field(default="", description="stores current question")
#     covered_topics:   list[str] = Field(default_factory=list, description="stores all covered topics")

# class ScoreEntry(BaseModel):
#     question:   str = Field(default="", description="the question that was asked")
#     score:      int = Field(default=0,  description="score out of 10")
#     evaluation: str = Field(default="", description="brief evaluation comment")

# class get_evaluate_schema(BaseModel):
#     scores:            list[ScoreEntry] = Field(default=[], description="scores per answer")
#     needs_followup:    bool             = Field(default=False, description="whether follow-up is needed")
#     followup_question: str              = Field(default="", description="follow-up question text")
#     weak_topics:       list[str]        = Field(default=[], description="weak topics")
#     strong_topics:     list[str]        = Field(default=[], description="strong topics")

# class gen_followup_ques_schema(BaseModel):
#     current_question: str = Field(default="", description="stores the followup question")

# class final_report_schema(BaseModel):
#     overall_performance_rating: str      = Field(default="", description="Excellent/Good/Average/Below Average")
#     hiring_recommendation:      str      = Field(default="", description="Strongly Recommend/Recommend/Neutral/Do Not Recommend")
#     average_score:              float    = Field(default=0.0, description="average score out of 10")
#     total_percentage:           float    = Field(default=0.0, description="total percentage scored")
#     strong_topics:              list[str] = Field(default=[], description="strong topic areas")
#     weak_topics:                list[str] = Field(default=[], description="weak topic areas")
#     critical_missing_skills:    list[str] = Field(default=[], description="skills in JD but missing in candidate")
#     final_verdict:              str      = Field(default="", description="2-3 sentence assessment")


# # ── InterviewState ─────────────────────────────────────────────
# class InterviewState(TypedDict):
#     resume_text:           str
#     job_description:       dict
#     candidate_skills:      list[str]
#     candidate_experience:  list[str]
#     candidate_project:     list[str]
#     interview_context:     str
#     conversation:          Annotated[list, add_messages]
#     covered_topics:        list[str]
#     current_question:      str
#     current_answer:        str
#     question_count:        int
#     max_questions:         int
#     scores:                list[str]
#     needs_followup:        bool
#     followup_question:     str
#     weak_topics:           list[str]
#     strong_topics:         list[str]
#     tool_response:         str
#     tool_call_count:       bool
#     interview_phase:       Literal["setup","asking","evaluating","followup","next_question","finished"]
#     followup_count:        int
#     final_report:          str
#     speaking_scores:       list[dict]
#     report_avg_fluency:    float
#     report_avg_ttr:        float
#     report_filler_ratio:   float
#     report_vocab_level:    str
#     report_speaking_notes: str
#     report_rating:         str
#     report_recommendation: str
#     report_avg_score:      float
#     report_percentage:     float
#     report_strong_topics:  list[str]
#     report_weak_topics:    list[str]
#     report_missing_skills: list[str]
#     report_verdict:        str


# # ── Speaking skill scorer ──────────────────────────────────────
# def score_speaking_skill(state: InterviewState) -> dict:
#     scores             = analyze_speaking(state["current_answer"])
#     scores["question"] = state["current_question"]

#     existing   = state.get("speaking_scores") or []
#     all_scores = existing + [scores]

#     fluencies    = [s["fluency_score"] for s in all_scores if s.get("fluency_score")]
#     ttrs         = [s["ttr"]           for s in all_scores if s.get("ttr")]
#     filler_rats  = [s["filler_ratio"]  for s in all_scores if s.get("filler_ratio") is not None]
#     vocab_levels = [s["vocab_level"]   for s in all_scores if s.get("vocab_level")]

#     avg_fluency = round(sum(fluencies)   / len(fluencies),   1) if fluencies   else 0.0
#     avg_ttr     = round(sum(ttrs)        / len(ttrs),        3) if ttrs        else 0.0
#     avg_filler  = round(sum(filler_rats) / len(filler_rats), 1) if filler_rats else 0.0
#     vocab_level = Counter(vocab_levels).most_common(1)[0][0]    if vocab_levels else "N/A"

#     return {
#         "speaking_scores":     all_scores,
#         "report_avg_fluency":  avg_fluency,
#         "report_avg_ttr":      avg_ttr,
#         "report_filler_ratio": avg_filler,
#         "report_vocab_level":  vocab_level,
#     }


# # ── Nodes ──────────────────────────────────────────────────────
# def resume_parsing(state: InterviewState) -> dict:
#     llm    = get_interview_llm()
#     parser = PydanticOutputParser(pydantic_object=get_resume_schema)
#     chain  = llm | cleaner | parser
#     prompt = f"""
# You are an expert resume parser. Analyze the resume and extract candidate information.
# Resume:
# {state['resume_text']}

# Extract:
# 1. candidate_skills - List technical skills, languages, frameworks, tools, databases, cloud platforms.
# 2. candidate_experience - Format: "Role | Company | Duration | Key responsibilities"
# 3. candidate_project - Format: "Project Name | Technologies Used | Brief Description"

# CRITICAL RULES:
# - Return ONLY a raw JSON object.
# - Do NOT write any Python code.
# - Do NOT include explanation, markdown, or text outside the JSON.
# - Do NOT use ```json or ``` wrappers.
# - Your entire response must start with {{ and end with }}

# {parser.get_format_instructions()}
# """
#     result = chain.invoke(prompt)
#     return {
#         "candidate_skills":     result.candidate_skills,
#         "candidate_experience": result.candidate_experience,
#         "candidate_project":    result.candidate_project,
#     }


# def generate_question(state: InterviewState) -> dict:
#     llm    = get_interview_llm()
#     parser = PydanticOutputParser(pydantic_object=get_question_gen_schema)
#     chain  = llm | cleaner | parser
#     prompt = f"""You are an expert technical interviewer.
# Conversation History: {state["conversation"]}
# Job Description: {state["job_description"]}
# Candidate Skills: {state["candidate_skills"]}
# Candidate Experience: {state["candidate_experience"]}
# Candidate Projects: {state["candidate_project"]}

# Instructions:
# 1. Analyze the conversation and identify topics already covered.
# 2. Generate ONE new interview question that:
#    * Is relevant to the job description.
#    * Is not a repeat of previously covered topics.
#    * Matches the candidate's experience level.
#    * Explores skill gaps between candidate skills and JD requirements.
#    * Is concise (1-2 sentences).
# 3. Update the covered_topics list with all previous + new topic.

# CRITICAL RULES:
# - Return ONLY a raw JSON object.
# - Do NOT use ```json or ``` wrappers.
# - Your entire response must start with {{ and end with }}

# {parser.get_format_instructions()}
# """
#     result = chain.invoke(prompt)
#     return {
#         "current_question": result.current_question,
#         "conversation":     [AIMessage(content=result.current_question)],
#         "covered_topics":   state["covered_topics"] + result.covered_topics,
#         "question_count":   state["question_count"] + 1,
#         "interview_phase":  "asking",
#         "needs_followup":   False,
#         "followup_count":   0,
#     }


# def ask_human(state: InterviewState) -> dict:
#     answer = interrupt({"question": state["current_question"]})
#     if not answer or answer.strip() == "":
#         return {"current_answer": "i dont know the answer"}
#     return {"current_answer": answer}


# def ask_followup_human(state: InterviewState) -> dict:
#     answer = interrupt({"question": state["current_question"]})
#     if not answer or answer.strip() == "":
#         return {"current_answer": "i dont know the answer"}
#     return {"current_answer": answer}


# def evaluate_response(state: InterviewState) -> dict:
#     llm    = get_interview_llm()
#     parser = PydanticOutputParser(pydantic_object=get_evaluate_schema)
#     chain  = llm | cleaner | parser
#     prompt = f"""You are an expert technical interviewer and evaluator.
# Interview Context: {state["conversation"]}
# Current Question: {state["current_question"]}
# Candidate Answer: {state["current_answer"]}

# Evaluation Guidelines:
# 1. Score 1-10: 9-10 Excellent, 7-8 Good, 5-6 Partial, 3-4 Weak, 1-2 Incorrect.
# 2. Set needs_followup=True if answer is vague, incomplete, or needs more depth.
# 3. Set needs_followup=False if answer demonstrates clear conceptual understanding.

# CRITICAL RULES:
# - Return ONLY a raw JSON object.
# - Do NOT use ```json or ``` wrappers.
# - Your entire response must start with {{ and end with }}

# {parser.get_format_instructions()}
# """
#     result = chain.invoke(prompt)
#     new_scores = [
#         f"Q: {s.question} | Score: {s.score}/10 | {s.evaluation}"
#         for s in result.scores
#     ]
#     return {
#         "scores":          state["scores"] + new_scores,
#         "weak_topics":     state["weak_topics"]   + result.weak_topics,
#         "strong_topics":   state["strong_topics"] + result.strong_topics,
#         "needs_followup":  result.needs_followup,
#         "interview_phase": "evaluating",
#         "conversation":    state["conversation"] + [HumanMessage(content=state["current_answer"])],
#     }


# def generate_followup(state: InterviewState) -> dict:
#     llm    = get_interview_llm()
#     parser = PydanticOutputParser(pydantic_object=gen_followup_ques_schema)
#     chain  = llm | cleaner | parser
#     prompt = f"""You are an expert technical interviewer.
# Generate a follow-up question based on the candidate's previous answer.

# Conversation History: {state["conversation"]}
# Previous Question: {state["current_question"]}
# Candidate's Answer: {state["current_answer"]}
# Weak Topics Identified: {state["weak_topics"]}

# Instructions:
# 1. Analyze the candidate's answer carefully.
# 2. Generate ONE follow-up question targeting the biggest weakness.
# 3. Keep it concise (1-2 sentences), progressively deeper.
# 4. Do not ask a completely new topic.

# CRITICAL RULES:
# - Return ONLY a raw JSON object.
# - Do NOT use ```json or ``` wrappers.
# - Your entire response must start with {{ and end with }}

# {parser.get_format_instructions()}
# """
#     result   = chain.invoke(prompt)
#     question = result.current_question.strip()
#     if not question:
#         last_weak = state["weak_topics"][-1] if state["weak_topics"] else "that topic"
#         question  = f"Can you elaborate more on your understanding of {last_weak}?"
#     return {
#         "current_question": question,
#         "followup_count":   state["followup_count"] + 1,
#         "interview_phase":  "followup",
#     }


# def generate_final_report(state: InterviewState) -> dict:
#     llm    = get_interview_llm()
#     parser = PydanticOutputParser(pydantic_object=final_report_schema)
#     chain  = llm | cleaner | parser
#     prompt = f"""You are an expert technical interviewer generating a concise final report.

# Interview Data:
# - Total Questions Asked: {state["question_count"]}
# - Scores Per Question: {state["scores"]}
# - Strong Topics: {state["strong_topics"]}
# - Weak Topics: {state["weak_topics"]}
# - Job Description: {state["job_description"]}
# - Candidate Skills: {state["candidate_skills"]}

# Instructions — SHORT and CONCISE evaluation:
# 1. overall_performance_rating: Excellent / Good / Average / Below Average
# 2. hiring_recommendation: Strongly Recommend / Recommend / Neutral / Do Not Recommend
# 3. average_score: average of all scores out of 10
# 4. total_percentage: (average_score / 10 * 100)
# 5. strong_topics: top strong areas
# 6. weak_topics: key weak areas
# 7. critical_missing_skills: skills in JD not demonstrated
# 8. final_verdict: 2-3 sentences only

# CRITICAL RULES:
# - Return ONLY a raw JSON object.
# - Do NOT use ```json or ``` wrappers.
# - Your entire response must start with {{ and end with }}

# {parser.get_format_instructions()}
# """
#     result    = chain.invoke(prompt)
#     formatted = f"""
# INTERVIEW EVALUATION REPORT
# {'='*44}
# Rating         : {result.overall_performance_rating}
# Recommendation : {result.hiring_recommendation}
# Avg Score      : {result.average_score:.1f} / 10
# Percentage     : {result.total_percentage:.1f}%
# Strong Topics  : {", ".join(result.strong_topics)}
# Weak Topics    : {", ".join(result.weak_topics)}
# Missing Skills : {", ".join(result.critical_missing_skills)}

# Verdict:
# {result.final_verdict}
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


# # ── Routers ────────────────────────────────────────────────────
# def route_after_evaluation(state: InterviewState) -> str:
#     if state["needs_followup"] and state["followup_count"] < 2:
#         return "followup"
#     if state["question_count"] >= state["max_questions"]:
#         return "finished"
#     return "next"


# def route_after_followup_eval(state: InterviewState) -> str:
#     if state["question_count"] >= state["max_questions"]:
#         return "finished"
#     return "next"


# # ── Graph ──────────────────────────────────────────────────────
# def build_interview_graph():
#     graph = StateGraph(InterviewState)

#     graph.add_node("resume_parsing",          resume_parsing)
#     graph.add_node("generate_question",       generate_question)
#     graph.add_node("ask_human",               ask_human)
#     graph.add_node("evaluate_response",       evaluate_response)
#     graph.add_node("score_speaking_skill",    score_speaking_skill)
#     graph.add_node("generate_followup",       generate_followup)
#     graph.add_node("ask_followup_human",      ask_followup_human)
#     graph.add_node("evaluate_followup",       evaluate_response)
#     graph.add_node("score_speaking_followup", score_speaking_skill)
#     graph.add_node("generate_final_report",   generate_final_report)

#     graph.set_entry_point("resume_parsing")

#     graph.add_edge("resume_parsing",    "generate_question")
#     graph.add_edge("generate_question", "ask_human")
#     graph.add_edge("ask_human",         "evaluate_response")
#     graph.add_edge("evaluate_response", "score_speaking_skill")

#     graph.add_conditional_edges(
#         "score_speaking_skill",
#         route_after_evaluation,
#         {"followup": "generate_followup", "next": "generate_question", "finished": "generate_final_report"},
#     )

#     graph.add_edge("generate_followup",  "ask_followup_human")
#     graph.add_edge("ask_followup_human", "evaluate_followup")
#     graph.add_edge("evaluate_followup",  "score_speaking_followup")

#     graph.add_conditional_edges(
#         "score_speaking_followup",
#         route_after_followup_eval,
#         {"next": "generate_question", "finished": "generate_final_report"},
#     )

#     graph.add_edge("generate_final_report", END)
#     return graph


# # ── Singleton ──────────────────────────────────────────────────
# _memory = MemorySaver()
# _app    = None

# def get_interview_app():
#     global _app
#     if _app is None:
#         _app = build_interview_graph().compile(checkpointer=_memory)
#     return _app


# # ── Initial state template ─────────────────────────────────────
# INITIAL_STATE_TEMPLATE = {
#     "candidate_skills":      [],
#     "candidate_experience":  [],
#     "candidate_project":     [],
#     "conversation":          [],
#     "covered_topics":        [],
#     "current_question":      "",
#     "current_answer":        "",
#     "interview_context":     "",
#     "question_count":        0,
#     "scores":                [],
#     "needs_followup":        False,
#     "followup_question":     "",
#     "weak_topics":           [],
#     "strong_topics":         [],
#     "tool_response":         "",
#     "tool_call_count":       False,
#     "interview_phase":       "setup",
#     "followup_count":        0,
#     "final_report":          "",
#     "speaking_scores":       [],
#     "report_avg_fluency":    0.0,
#     "report_avg_ttr":        0.0,
#     "report_filler_ratio":   0.0,
#     "report_vocab_level":    "N/A",
#     "report_speaking_notes": "",
#     "report_rating":         "",
#     "report_recommendation": "",
#     "report_avg_score":      0.0,
#     "report_percentage":     0.0,
#     "report_strong_topics":  [],
#     "report_weak_topics":    [],
#     "report_missing_skills": [],
#     "report_verdict":        "",
# }


# # ── Session helpers ────────────────────────────────────────────
# def create_interview_session(resume_text: str, job_description: dict, max_questions: int = 5) -> str:
#     app       = get_interview_app()
#     thread_id = str(uuid.uuid4())
#     config    = {"configurable": {"thread_id": thread_id}}

#     initial_state = {
#         **INITIAL_STATE_TEMPLATE,
#         "resume_text":     resume_text,
#         "job_description": job_description,
#         "max_questions":   max_questions,
#     }

#     for _ in app.stream(initial_state, config=config, stream_mode="values"):
#         pass

#     return thread_id


# def get_current_question(thread_id: str) -> dict:
#     app      = get_interview_app()
#     config   = {"configurable": {"thread_id": thread_id}}
#     snapshot = app.get_state(config)
#     values   = snapshot.values
#     return {
#         "question":       values.get("current_question", ""),
#         "phase":          values.get("interview_phase", ""),
#         "question_count": values.get("question_count", 0),
#         "max_questions":  values.get("max_questions", 0),
#         "followup_count": values.get("followup_count", 0),
#         "final_report":   values.get("final_report", ""),
#         "report": {
#             "rating":          values.get("report_rating", ""),
#             "recommendation":  values.get("report_recommendation", ""),
#             "avg_score":       values.get("report_avg_score", 0.0),
#             "percentage":      values.get("report_percentage", 0.0),
#             "strong_topics":   values.get("report_strong_topics", []),
#             "weak_topics":     values.get("report_weak_topics", []),
#             "missing_skills":  values.get("report_missing_skills", []),
#             "verdict":         values.get("report_verdict", ""),
#             "avg_fluency":     values.get("report_avg_fluency", 0.0),
#             "avg_ttr":         values.get("report_avg_ttr", 0.0),
#             "filler_ratio":    values.get("report_filler_ratio", 0.0),
#             "vocab_level":     values.get("report_vocab_level", "N/A"),
#             "speaking_scores": values.get("speaking_scores", []),
#         },
#     }


# def submit_answer(thread_id: str, answer: str) -> dict:
#     from langgraph.types import Command
#     app    = get_interview_app()
#     config = {"configurable": {"thread_id": thread_id}}

#     for _ in app.stream(Command(resume=answer), config=config, stream_mode="values"):
#         pass

#     return get_current_question(thread_id)