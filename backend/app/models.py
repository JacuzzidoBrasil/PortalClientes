from sqlalchemy import Column, Integer, String, Enum, ForeignKey, Table, Boolean, DateTime, Date, Numeric, Float, UniqueConstraint, Index
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


class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    cnpj = Column(String(18), nullable=False)
    invoice_number = Column(String(50), nullable=False)
    invoice_date = Column(Date, nullable=True)
    total_value = Column(Numeric(14, 2), nullable=True)
    file_path = Column(String(255), nullable=False)
    file_hash = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime, nullable=True)

    user = relationship("User")


class PricingMasterItem(Base):
    __tablename__ = "pricing_master_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    uf = Column(String(2), nullable=False)
    num_list = Column(String(20), nullable=True)
    den_list = Column(String(50), nullable=True)
    cod_item = Column(String(30), nullable=False)
    den_item = Column(String(255), nullable=True)
    um = Column(String(20), nullable=True)
    cla_fisc = Column(String(30), nullable=True)
    pre_unit = Column(Float, nullable=False, default=0.0)
    aliq_ipi = Column(Float, nullable=False, default=0.0)
    iva = Column(Float, nullable=False, default=0.0)
    aliq_st = Column(Float, nullable=False, default=0.0)

    __table_args__ = (
        Index("ix_pricing_master_uf_cod_item", "uf", "cod_item"),
    )


class PricingClientProgram(Base):
    __tablename__ = "pricing_client_programs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cod_empresa = Column(String(10), nullable=True)
    cod_cliente = Column(String(20), nullable=False)
    programa = Column(String(60), nullable=False)
    categoria = Column(String(60), nullable=False)

    __table_args__ = (
        Index("ix_pricing_client_program_cod_cliente", "cod_cliente"),
        Index("ix_pricing_client_program_cod_cliente_prog_cat", "cod_cliente", "programa", "categoria"),
    )


class PricingProgramItemDiscount(Base):
    __tablename__ = "pricing_program_item_discounts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cod_empresa = Column(String(10), nullable=True)
    programa = Column(String(60), nullable=False)
    categoria = Column(String(60), nullable=False)
    cod_item = Column(String(30), nullable=False)
    desc_base = Column(String(100), nullable=True)
    desc_redu = Column(String(100), nullable=True)
    desc_prog = Column(String(100), nullable=True)
    desc_camp = Column(String(100), nullable=True)
    vald_camp = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_pricing_program_item_programa_categoria_item", "programa", "categoria", "cod_item"),
    )


class PricingClientItemDiscount(Base):
    __tablename__ = "pricing_client_item_discounts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cod_empresa = Column(String(10), nullable=True)
    cod_cliente = Column(String(20), nullable=False)
    cod_item = Column(String(30), nullable=False)
    desc_cli = Column(String(100), nullable=True)

    __table_args__ = (
        Index("ix_pricing_client_item_cod_cliente_item", "cod_cliente", "cod_item"),
    )


class PricingUfItemDiscount(Base):
    __tablename__ = "pricing_uf_item_discounts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cod_empresa = Column(String(10), nullable=True)
    cod_uf = Column(String(2), nullable=False)
    cod_item = Column(String(30), nullable=False)
    desc_uf = Column(String(100), nullable=True)

    __table_args__ = (
        Index("ix_pricing_uf_item_cod_uf_item", "cod_uf", "cod_item"),
    )


class PricingResultCache(Base):
    __tablename__ = "pricing_result_cache"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cnpj = Column(String(20), nullable=False)
    uf = Column(String(2), nullable=False)
    cod_item = Column(String(30), nullable=False)
    den_item = Column(String(255), nullable=True)
    pre_unit = Column(Float, nullable=False, default=0.0)
    descontos_cascata = Column(String(255), nullable=True)
    base_liquida = Column(Float, nullable=False, default=0.0)
    aliq_ipi = Column(Float, nullable=False, default=0.0)
    aliq_st = Column(Float, nullable=False, default=0.0)
    valor_ipi = Column(Float, nullable=False, default=0.0)
    valor_st = Column(Float, nullable=False, default=0.0)
    valor_final = Column(Float, nullable=False, default=0.0)
    programa = Column(String(60), nullable=False)
    categoria = Column(String(60), nullable=False)
    source = Column(String(30), nullable=False, default="db")
    updated_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("ix_pricing_cache_cnpj_uf", "cnpj", "uf"),
        UniqueConstraint("cnpj", "uf", "programa", "categoria", "cod_item", name="uq_pricing_cache_cnpj_uf_prog_cat_item"),
    )

