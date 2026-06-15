CREATE DATABASE IF NOT EXISTS curator_journal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE curator_journal;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS event_participants;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS grades;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS parents;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS study_groups;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;

CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(30) NOT NULL UNIQUE,
  title VARCHAR(80) NOT NULL
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE study_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_name VARCHAR(30) NOT NULL UNIQUE,
  specialty VARCHAR(150) NOT NULL,
  course_number TINYINT NOT NULL,
  study_year VARCHAR(20) NOT NULL,
  curator_id INT NULL,
  FOREIGN KEY (curator_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  birth_date DATE NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  status ENUM('active','academic_leave','expelled','graduated') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE RESTRICT
);

CREATE TABLE parents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  relation_type VARCHAR(50) NOT NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(120) NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  teacher_name VARCHAR(150) NULL,
  FOREIGN KEY (group_id) REFERENCES study_groups(id) ON DELETE CASCADE
);

CREATE TABLE attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  subject_id INT NOT NULL,
  lesson_date DATE NOT NULL,
  status ENUM('present','valid_absent','absent','late') NOT NULL,
  comment VARCHAR(255) NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_attendance (student_id, subject_id, lesson_date)
);

CREATE TABLE grades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  subject_id INT NOT NULL,
  grade_value VARCHAR(10) NOT NULL,
  grade_date DATE NOT NULL,
  control_type VARCHAR(80) NOT NULL,
  comment VARCHAR(255) NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  event_date DATE NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  event_place VARCHAR(150) NOT NULL,
  organizer VARCHAR(150) NOT NULL,
  target_audience VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  result TEXT NULL,
  created_by INT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE event_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  student_id INT NOT NULL,
  participation_status ENUM('visited','missed','active') NOT NULL DEFAULT 'visited',
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_event_student (event_id, student_id)
);

CREATE TABLE audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(120) NOT NULL,
  entity_name VARCHAR(80) NOT NULL,
  entity_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
