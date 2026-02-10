from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth, admin, spreadsheets

app = FastAPI(title="Portal Clientes")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://chatbot-frontend.mmidem.easypanel.host",
        "https://chatbot-aaa.mmidem.easypanel.host",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(spreadsheets.router)
