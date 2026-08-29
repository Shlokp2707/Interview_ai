import json
import threading
from django.conf import settings
from langchain_groq import ChatGroq
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field
from typing import List
from .models import Application, InterviewFeedback

class WeaknessItem(BaseModel):
    concept: str = Field(description="Name of the weak concept or incorrect answer")
    feedback: str = Field(description="Helpful constructive coaching feedback or explanation of why it was incorrect")
    study_query: str = Field(description="Search term/query the student can use to search and study this concept")

class StudyResourceItem(BaseModel):
    title: str = Field(description="Title of the documentation page or tutorial")
    url: str = Field(description="A valid, real reference URL (e.g. from MDN Web Docs, W3Schools, Python documentation, React docs) corresponding to the concept")

class GrowthFeedbackSchema(BaseModel):
    weaknesses: List[WeaknessItem] = Field(default_factory=list)
    strengths: List[str] = Field(default_factory=list)
    study_resources: List[StudyResourceItem] = Field(default_factory=list)

def get_growth_llm():
    google_key = getattr(settings, "GOOGLE_API_KEY", "")
    if google_key and "your_google_api_key" not in google_key:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model="gemini-1.5-flash",
                google_api_key=google_key,
                temperature=0.2
            )
        except Exception:
            pass
    api_key = getattr(settings, "GROQ_API_KEY", None)
    return ChatGroq(
        model="qwen/qwen3.6-27b",
        api_key=api_key,
        temperature=0.2
    )

def generate_growth_feedback_sync(application_id: int):
    try:
        application = Application.objects.get(id=application_id)
        if InterviewFeedback.objects.filter(application=application).exists():
            return
            
        transcript = application.interview_report or ""
        analytics = application.interview_analytics or {}
        
        prompt = f"""
        You are an AI Interview Coach. Your goal is to review a candidate's technical interview transcript and evaluation report, and compile constructive growth feedback to help them study and improve.
        
        INTERVIEW TRANSCRIPT & REPORT:
        -------------------------
        {transcript}
        -------------------------
        
        SPEAKING ANALYTICS:
        -------------------------
        Vocab Level: {application.interview_vocab_level}
        Filler Ratio: {application.interview_filler_ratio}%
        Fluency: {application.interview_speaking_fluency}/10
        -------------------------
        
        Instructions:
        1. Identify 2-4 key technical weaknesses, concepts defined incorrectly, or gaps in candidate's answers.
        2. Formulate helpful feedback explaining the correct concepts.
        3. Provide specific search terms (study_query) for each weakness.
        4. List 2-4 real study links (documentation pages from MDN Web Docs, W3Schools, Python docs, React docs, SQL tutorials, etc.) corresponding to their weak topics. Make sure URLs are real and accurate.
        5. List 2-3 key technical strengths or strong answers.
        
        Return the result strictly formatted according to the JSON format.
        """
        
        llm = get_growth_llm()
        parser = PydanticOutputParser(pydantic_object=GrowthFeedbackSchema)
        
        def clean_llm_output(message):
            text = message.content if hasattr(message, "content") else str(message)
            import re
            json_block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
            if json_block:
                return json_block.group(1)
            start = text.find("{")
            end   = text.rfind("}")
            if start != -1 and end != -1:
                return text[start:end + 1]
            return text
            
        cleaner = RunnableLambda(clean_llm_output)
        chain = llm | cleaner
        
        raw_text = chain.invoke(f"{prompt}\n\n{parser.get_format_instructions()}")
        parsed = parser.parse(raw_text)
        
        # Determine whether it should be shared immediately (e.g. for mock practice)
        is_practice = (application.job.company == "Mock Practice Room")
        
        InterviewFeedback.objects.create(
            application=application,
            weaknesses=[{"concept": w.concept, "feedback": w.feedback, "study_query": w.study_query} for w in parsed.weaknesses],
            strengths=parsed.strengths,
            study_resources=[{"title": r.title, "url": r.url} for r in parsed.study_resources],
            is_shared_with_candidate=is_practice
        )
        print(f"[GrowthAgent] Growth report generated for application {application_id}")
    except Exception as e:
        print(f"[GrowthAgent] Error generating growth feedback: {e}")
        import traceback
        traceback.print_exc()

def trigger_generate_growth_feedback(application_id: int):
    thread = threading.Thread(target=generate_growth_feedback_sync, args=(application_id,))
    thread.daemon = True
    thread.start()
