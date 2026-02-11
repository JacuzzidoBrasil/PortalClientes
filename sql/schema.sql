CREATE DATABASE portal_clientes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE portal_clientes;

CREATE TABLE access_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cnpj VARCHAR(18) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(120),
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active','inactive') DEFAULT 'active',
  is_admin TINYINT(1) DEFAULT 0,
  first_access_completed TINYINT(1) DEFAULT 0,
  first_access_code_hash CHAR(64),
  first_access_code_expires DATETIME,
  reset_code_hash CHAR(64),
  reset_code_expires DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_access_levels (
  user_id INT NOT NULL,
  access_level_id INT NOT NULL,
  PRIMARY KEY (user_id, access_level_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (access_level_id) REFERENCES access_levels(id) ON DELETE CASCADE
);

CREATE TABLE spreadsheets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  uploaded_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE spreadsheet_access (
  spreadsheet_id INT NOT NULL,
  access_level_id INT NOT NULL,
  PRIMARY KEY (spreadsheet_id, access_level_id),
  FOREIGN KEY (spreadsheet_id) REFERENCES spreadsheets(id) ON DELETE CASCADE,
  FOREIGN KEY (access_level_id) REFERENCES access_levels(id) ON DELETE CASCADE
);

INSERT INTO access_levels (name) VALUES
('Deep dive Legend'),
('Deep dive Infinite'),
('Deep dive Prime'),
('Deep dive Select'),
('Deep dive Open'),
('Deep dive Standard'),
('Restore You Aqualibrium'),
('Restore You Widestream'),
('Restore You PowerPro'),
('Restore You TargetPro'),
('Restore You Standard'),
('Express'),
('Grow2gether'),
('Deep dive Infinite Regional'),
('Deep dive Legend Regional'),
('Deep dive Open Regional'),
('Deep dive Prime Regional'),
('Deep dive Select Regional'),
('Deep dive Standard Regional'),
('Grow2gether Regional'),
('Restore You Aqualibrium Regional'),
('Restore You PowerPro Regional'),
('Restore You Standard Regional'),
('Restore You TargetPro Regional'),
('Restore You Widestream Regional'),
('Ecommerce');
