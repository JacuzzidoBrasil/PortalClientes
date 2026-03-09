CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  cnpj VARCHAR(18) NOT NULL,
  invoice_number VARCHAR(50) NOT NULL,
  invoice_date DATE NULL,
  total_value DECIMAL(14,2) NULL,
  file_path VARCHAR(255) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_invoices_hash (file_hash),
  INDEX idx_invoices_user (user_id)
);
