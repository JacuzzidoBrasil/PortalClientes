CREATE TABLE IF NOT EXISTS extrato_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requested_by INT NOT NULL,
  status ENUM('pending','running','done','error') NOT NULL DEFAULT 'pending',
  input_month VARCHAR(20) NOT NULL DEFAULT 'FEVEREIRO 2026',
  customer_name VARCHAR(180) NOT NULL,
  pdf_path VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME,
  CONSTRAINT fk_extrato_jobs_user FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_extrato_jobs_status_created ON extrato_jobs (status, created_at);
