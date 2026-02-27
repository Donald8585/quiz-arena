from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import List
from app.models.database import get_db, Quiz, Question, GameResult

router = APIRouter()

class QuestionCreate(BaseModel):
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_answer: str
    time_limit: int = 15

class QuizCreate(BaseModel):
    title: str
    created_by: str
    questions: List[QuestionCreate]

class QuizResponse(BaseModel):
    id: int
    title: str
    created_by: str
    class Config:
        from_attributes = True

@router.post("/", response_model=QuizResponse)
async def create_quiz(quiz_data: QuizCreate, db: AsyncSession = Depends(get_db)):
    quiz = Quiz(title=quiz_data.title, created_by=quiz_data.created_by)
    db.add(quiz)
    await db.flush()
    for q in quiz_data.questions:
        question = Question(quiz_id=quiz.id, question_text=q.question_text, option_a=q.option_a, option_b=q.option_b, option_c=q.option_c, option_d=q.option_d, correct_answer=q.correct_answer, time_limit=q.time_limit)
        db.add(question)
    await db.commit()
    await db.refresh(quiz)
    return quiz

@router.get("/", response_model=List[QuizResponse])
async def list_quizzes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Quiz).where(Quiz.is_active == True))
    return result.scalars().all()

@router.get("/{quiz_id}")
async def get_quiz(quiz_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Quiz).where(Quiz.id == quiz_id))
    quiz = result.scalar_one_or_none()
    if not quiz: raise HTTPException(status_code=404)
    q_result = await db.execute(select(Question).where(Question.quiz_id == quiz_id))
    questions = q_result.scalars().all()
    return {"id": quiz.id, "title": quiz.title, "questions": [{"id": q.id, "question_text": q.question_text, "option_a": q.option_a, "option_b": q.option_b, "option_c": q.option_c, "option_d": q.option_d, "correct_answer": q.correct_answer} for q in questions]}

@router.post("/results")
async def save_result(room_id: str, username: str, score: int, db: AsyncSession = Depends(get_db)):
    r = GameResult(room_id=room_id, username=username, score=score)
    db.add(r)
    await db.commit()
    return {"message": "Saved"}

@router.get("/leaderboard/top")
async def get_leaderboard(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GameResult.username, func.sum(GameResult.score).label("total")).group_by(GameResult.username).order_by(func.sum(GameResult.score).desc()).limit(10))
    return [{"username": r[0], "total_score": r[1]} for r in result.all()]
