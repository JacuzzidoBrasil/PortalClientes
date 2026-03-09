-- pricing v2 source + cache tables

CREATE TABLE IF NOT EXISTS pricing_master_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uf CHAR(2) NOT NULL,
  num_list VARCHAR(20),
  den_list VARCHAR(50),
  cod_item VARCHAR(30) NOT NULL,
  den_item VARCHAR(255),
  um VARCHAR(20),
  cla_fisc VARCHAR(30),
  pre_unit DECIMAL(18,6) NOT NULL DEFAULT 0,
  aliq_ipi DECIMAL(10,6) NOT NULL DEFAULT 0,
  iva DECIMAL(10,6) NOT NULL DEFAULT 0,
  aliq_st DECIMAL(10,6) NOT NULL DEFAULT 0,
  KEY ix_pricing_master_uf_cod_item (uf, cod_item)
);

CREATE TABLE IF NOT EXISTS pricing_client_programs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cod_empresa VARCHAR(10),
  cod_cliente VARCHAR(20) NOT NULL,
  programa VARCHAR(60) NOT NULL,
  categoria VARCHAR(60) NOT NULL,
  UNIQUE KEY uq_pricing_client_program_cod_cliente (cod_cliente),
  KEY ix_pricing_client_program_cod_cliente (cod_cliente)
);

CREATE TABLE IF NOT EXISTS pricing_program_item_discounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cod_empresa VARCHAR(10),
  programa VARCHAR(60) NOT NULL,
  categoria VARCHAR(60) NOT NULL,
  cod_item VARCHAR(30) NOT NULL,
  desc_base VARCHAR(100),
  desc_redu VARCHAR(100),
  desc_prog VARCHAR(100),
  desc_camp VARCHAR(100),
  vald_camp DATETIME NULL,
  KEY ix_pricing_program_item_programa_categoria_item (programa, categoria, cod_item)
);

CREATE TABLE IF NOT EXISTS pricing_client_item_discounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cod_empresa VARCHAR(10),
  cod_cliente VARCHAR(20) NOT NULL,
  cod_item VARCHAR(30) NOT NULL,
  desc_cli VARCHAR(100),
  KEY ix_pricing_client_item_cod_cliente_item (cod_cliente, cod_item)
);

CREATE TABLE IF NOT EXISTS pricing_uf_item_discounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cod_empresa VARCHAR(10),
  cod_uf CHAR(2) NOT NULL,
  cod_item VARCHAR(30) NOT NULL,
  desc_uf VARCHAR(100),
  KEY ix_pricing_uf_item_cod_uf_item (cod_uf, cod_item)
);

CREATE TABLE IF NOT EXISTS pricing_result_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cnpj VARCHAR(20) NOT NULL,
  uf CHAR(2) NOT NULL,
  cod_item VARCHAR(30) NOT NULL,
  den_item VARCHAR(255),
  pre_unit DECIMAL(18,6) NOT NULL DEFAULT 0,
  descontos_cascata VARCHAR(255),
  base_liquida DECIMAL(18,6) NOT NULL DEFAULT 0,
  aliq_ipi DECIMAL(10,6) NOT NULL DEFAULT 0,
  aliq_st DECIMAL(10,6) NOT NULL DEFAULT 0,
  valor_ipi DECIMAL(18,6) NOT NULL DEFAULT 0,
  valor_st DECIMAL(18,6) NOT NULL DEFAULT 0,
  valor_final DECIMAL(18,6) NOT NULL DEFAULT 0,
  programa VARCHAR(60) NOT NULL,
  categoria VARCHAR(60) NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'db',
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_pricing_cache_cnpj_uf_item (cnpj, uf, cod_item),
  KEY ix_pricing_cache_cnpj_uf (cnpj, uf)
);