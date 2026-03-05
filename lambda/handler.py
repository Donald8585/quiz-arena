import json
import random
from datetime import datetime

QUESTION_BANK = {
    "general": [
        {"q": "What is the capital of France?", "options": ["London", "Berlin", "Paris", "Madrid"], "answer": 2},
        {"q": "Which planet is known as the Red Planet?", "options": ["Venus", "Mars", "Jupiter", "Saturn"], "answer": 1},
        {"q": "What is the largest ocean on Earth?", "options": ["Atlantic", "Indian", "Arctic", "Pacific"], "answer": 3},
        {"q": "Who painted the Mona Lisa?", "options": ["Van Gogh", "Da Vinci", "Picasso", "Monet"], "answer": 1},
        {"q": "What is the chemical symbol for gold?", "options": ["Go", "Gd", "Au", "Ag"], "answer": 2},
        {"q": "Which country has the most population?", "options": ["USA", "India", "China", "Indonesia"], "answer": 1},
        {"q": "What year did World War II end?", "options": ["1943", "1944", "1945", "1946"], "answer": 2},
        {"q": "What is the speed of light?", "options": ["300k km/s", "150k km/s", "450k km/s", "600k km/s"], "answer": 0},
        {"q": "Which element has atomic number 1?", "options": ["Helium", "Hydrogen", "Lithium", "Carbon"], "answer": 1},
        {"q": "What is the tallest mountain in the world?", "options": ["K2", "Kangchenjunga", "Everest", "Lhotse"], "answer": 2},
    ],
    "tech": [
        {"q": "What does CPU stand for?", "options": ["Central Process Unit", "Central Processing Unit", "Computer Personal Unit", "Central Program Utility"], "answer": 1},
        {"q": "Who created Python?", "options": ["Guido van Rossum", "James Gosling", "Bjarne Stroustrup", "Dennis Ritchie"], "answer": 0},
        {"q": "What does HTML stand for?", "options": ["Hyper Text Markup Language", "High Tech Modern Language", "Hyper Transfer Markup Language", "Home Tool Markup Language"], "answer": 0},
        {"q": "Which company developed React?", "options": ["Google", "Apple", "Meta", "Amazon"], "answer": 2},
        {"q": "What is Docker used for?", "options": ["Database management", "Containerization", "Version control", "Load balancing"], "answer": 1},
        {"q": "What does API stand for?", "options": ["Application Program Interface", "Application Programming Interface", "Automated Programming Interface", "Application Process Integration"], "answer": 1},
        {"q": "Which cloud provider is owned by Amazon?", "options": ["Azure", "GCP", "AWS", "Alibaba Cloud"], "answer": 2},
        {"q": "What port does HTTP use by default?", "options": ["443", "8080", "22", "80"], "answer": 3},
        {"q": "What does SQL stand for?", "options": ["Structured Query Language", "Simple Query Language", "Standard Query Logic", "Sequential Query Language"], "answer": 0},
        {"q": "What is Kubernetes?", "options": ["A database", "A container orchestrator", "A programming language", "A web framework"], "answer": 1},
    ],
    "science": [
        {"q": "What is the chemical formula for water?", "options": ["H2O", "CO2", "NaCl", "O2"], "answer": 0},
        {"q": "What is the powerhouse of the cell?", "options": ["Nucleus", "Ribosome", "Mitochondria", "Golgi body"], "answer": 2},
        {"q": "What gas do plants absorb?", "options": ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], "answer": 2},
        {"q": "What is Newton's first law about?", "options": ["Gravity", "Inertia", "Acceleration", "Reaction"], "answer": 1},
        {"q": "How many chromosomes do humans have?", "options": ["23", "44", "46", "48"], "answer": 2},
        {"q": "What is the pH of pure water?", "options": ["0", "7", "14", "1"], "answer": 1},
        {"q": "Which vitamin does sunlight provide?", "options": ["A", "B", "C", "D"], "answer": 3},
        {"q": "What is the hardest natural substance?", "options": ["Gold", "Iron", "Diamond", "Platinum"], "answer": 2},
    ],
}


def lambda_handler(event, context):
    """Quiz Arena - Serverless Question Generator (AWS Lambda)"""
    try:
        body = json.loads(event.get("body", "{}")) if isinstance(event.get("body"), str) else event
    except (json.JSONDecodeError, TypeError):
        body = {}

    category = body.get("category", "general")
    difficulty = body.get("difficulty", "medium")
    count = min(body.get("count", 5), 10)
    action = body.get("action", "generate")

    if action == "validate":
        user_answers = body.get("answers", [])
        correct_answers = body.get("correct", [])
        score = sum(1 for u, c in zip(user_answers, correct_answers) if u == c)
        total = len(correct_answers)
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({
                "score": score,
                "total": total,
                "percentage": round(score / total * 100, 1) if total > 0 else 0,
                "validated_at": datetime.utcnow().isoformat(),
                "source": "aws-lambda",
            }),
        }

    questions = QUESTION_BANK.get(category, QUESTION_BANK["general"])
    selected = random.sample(questions, min(count, len(questions)))
    random.shuffle(selected)

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        "body": json.dumps({
            "questions": selected,
            "category": category,
            "difficulty": difficulty,
            "count": len(selected),
            "generated_at": datetime.utcnow().isoformat(),
            "source": "aws-lambda",
        }),
    }
