from sqlalchemy import Column, Integer, String, Enum, ForeignKey, Table, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.db import Base

user_access_levels = Table(
    "user_access_levels",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("access_level_id", Integer, ForeignKey("access_levels.id"), primary_key=True),
)

spreadsheet_access = Table(
    "spreadsheet_access",
    Base.metadata,
    Column("spreadsheet_id", Integer, ForeignKey("spreadsheets.id"), primary_key=True),
    Column("access_level_id", Integer, ForeignKey("access_levels.id"), primary_key=True),
)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cnpj = Column(String(18), unique=True, nullable=False)
    name = Column(String(120), nullable=False)
    email = Column(String(120), nullable=True)
    uf = Column(String(2), nullable=True)
    password_hash = Column(String(255), nullable=False)
    status = Column(Enum("active", "inactive"), default="active")
    is_admin = Column(Boolean, default=False)
    first_access_completed = Column(Boolean, default=False)
    first_access_code_hash = Column(String(64), nullable=True)
    first_access_code_expires = Column(DateTime, nullable=True)
    reset_code_hash = Column(String(64), nullable=True)
    reset_code_expires = Column(DateTime, nullable=True)

    access_levels = relationship(
        "AccessLevel",
        secondary=user_access_levels,
        back_populates="users",
    )

class AccessLevel(Base):
    __tablename__ = "access_levels"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)

    users = relationship(
        "User",
        secondary=user_access_levels,
        back_populates="access_levels",
    )
    spreadsheets = relationship(
        "Spreadsheet",
        secondary=spreadsheet_access,
        back_populates="access_levels",
    )

class Spreadsheet(Base):
    __tablename__ = "spreadsheets"
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(150), nullable=False)
    file_path = Column(String(255), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    access_levels = relationship(
        "AccessLevel",
        secondary=spreadsheet_access,
        back_populates="spreadsheets",
    )
