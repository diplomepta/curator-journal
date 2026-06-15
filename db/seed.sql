USE curator_journal;

INSERT INTO roles(name, title) VALUES
('admin','Администратор'),
('curator','Куратор'),
('viewer','Просмотр')
ON DUPLICATE KEY UPDATE title = VALUES(title);

INSERT INTO users(role_id, username, password_hash, full_name) VALUES
(1,'admin','240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9','Администратор системы'),
(2,'curator','958fd30f64ac34d82850e17dd0d816130c61fd42c64c8e5782515108da1b2eff','Иванова Мария Петровна'),
(3,'viewer','65375049b9e4d7cad6c9ba286fdeb9394b28135a3e84136404cfccfdcc438894','Пользователь просмотра')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

INSERT INTO study_groups(group_name, specialty, course_number, study_year, curator_id) VALUES
('09.07-28','Информационные системы и программирование',4,'2025-2026',2),
('09.07-29','Информационные системы и программирование',3,'2025-2026',2)
ON DUPLICATE KEY UPDATE specialty = VALUES(specialty);

INSERT INTO students(group_id, full_name, birth_date, phone, email, address, status, notes) VALUES
(1,'Абдуллин Рамиль Айдарович','2006-04-12','+7 900 111-22-33','abdullin@example.com','г. Казань','active','Староста группы'),
(1,'Васильева Алина Сергеевна','2006-08-03','+7 900 222-33-44','vasileva@example.com','г. Казань','active','Участвует в мероприятиях'),
(1,'Гарипов Тимур Русланович','2005-12-19','+7 900 333-44-55','garipov@example.com','г. Казань','active','Нужен контроль посещаемости'),
(2,'Козлова Дарья Игоревна','2007-02-15','+7 900 444-55-66','kozlova@example.com','г. Казань','active',''),
(2,'Мухаметшин Артём Ринатович','2007-07-21','+7 900 555-66-77','muhametshin@example.com','г. Казань','active','');

INSERT INTO parents(student_id, full_name, relation_type, phone, email) VALUES
(1,'Абдуллина Гузель Рамилевна','мать','+7 900 777-11-22','parent1@example.com'),
(2,'Васильев Сергей Николаевич','отец','+7 900 777-22-33','parent2@example.com'),
(3,'Гарипова Лилия Рустамовна','мать','+7 900 777-33-44','parent3@example.com');

INSERT INTO subjects(group_id, name, teacher_name) VALUES
(1,'Разработка веб-приложений','Петров А. Н.'),
(1,'Базы данных','Сидорова Е. В.'),
(1,'Информационная безопасность','Кузнецов И. В.'),
(2,'Основы программирования','Иванов П. С.'),
(2,'Компьютерные сети','Смирнова О. А.');

INSERT INTO attendance(student_id, subject_id, lesson_date, status, comment) VALUES
(1,1,CURDATE(),'present',''),
(2,1,CURDATE(),'late','Опоздание на 10 минут'),
(3,1,CURDATE(),'absent','Без причины');

INSERT INTO grades(student_id, subject_id, grade_value, grade_date, control_type, comment) VALUES
(1,1,'5',CURDATE(),'Практическая работа',''),
(2,1,'4',CURDATE(),'Практическая работа',''),
(3,2,'2',CURDATE(),'Контрольная работа','Нужна пересдача');

INSERT INTO events(title, event_date, event_type, event_place, organizer, target_audience, description, result, created_by) VALUES
('Классный час по цифровой безопасности',CURDATE(),'классный час','кабинет 204','Иванова Мария Петровна','студенты группы 09.07-28','Обсуждение правил безопасной работы в сети, защиты персональных данных и безопасного поведения в социальных сетях.','Студенты ознакомлены с правилами',2),
('Родительское собрание',DATE_ADD(CURDATE(), INTERVAL 5 DAY),'собрание','актовый зал','Иванова Мария Петровна','родители и законные представители','Обсуждение успеваемости, посещаемости и организационных вопросов учебной группы.','Запланировано',2);

INSERT INTO event_participants(event_id, student_id, participation_status) VALUES
(1,1,'active'),
(1,2,'visited'),
(1,3,'visited');
