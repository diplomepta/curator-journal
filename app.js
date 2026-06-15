import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import multer from 'multer';
import xlsx from 'xlsx';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const port = process.env.APP_PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'curator_journal',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({ secret: process.env.APP_SECRET || 'secret', resave: false, saveUninitialized: false }));

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

const statusLabels = {
  active: 'Активно обучается',
  academic_leave: 'Академический отпуск',
  expelled: 'Отчислен',
  graduated: 'Выпускник'
};

const attendanceLabels = {
  present: 'Присутствовал',
  valid_absent: 'Уважительная причина',
  absent: 'Отсутствовал',
  late: 'Опоздал'
};

const participationLabels = {
  active: 'Участвует',
  visited: 'Посетил',
  missed: 'Пропустил'
};

function labelByMap(map, value) {
  return map[value] || value || '';
}

function isValidFullName(value) {
  return Boolean(value) && !/\d/.test(value);
}

async function renderStudentForm(res, student, title, error = null) {
  const groups = await query('SELECT * FROM study_groups ORDER BY group_name');
  res.render('students/form', { student, groups, title, error });
}

async function logAction(req, action, entity, id = null) {
  if (!req.session.user) return;
  await query('INSERT INTO audit_log(user_id, action, entity_name, entity_id) VALUES(?,?,?,?)', [req.session.user.id, action, entity, id]);
}

function auth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function adminOnly(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Доступ запрещён');
  next();
}

function canEdit(req, res, next) {
  if (!req.session.user || req.session.user.role === 'viewer') return res.status(403).send('Доступ запрещён');
  next();
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.error = null;
  res.locals.statusLabel = value => labelByMap(statusLabels, value);
  res.locals.attendanceLabel = value => labelByMap(attendanceLabels, value);
  res.locals.participationLabel = value => labelByMap(participationLabels, value);
  next();
});


app.get('/register', async (req, res) => {
  const roles = await query('SELECT * FROM roles WHERE name IN ("curator", "viewer") ORDER BY id');
  res.render('register', { error: null, success: null, form: {}, roles });
});

app.post('/register', async (req, res) => {
  const { full_name, username, password, password_repeat, role_id } = req.body;
  const roles = await query('SELECT * FROM roles WHERE name IN ("curator", "viewer") ORDER BY id');
  const form = { full_name, username, role_id };

  if (!full_name || !username || !password || !password_repeat || !role_id) {
    return res.render('register', { error: 'Заполните все обязательные поля', success: null, form, roles });
  }

  if (!isValidFullName(full_name)) {
    return res.render('register', { error: 'В ФИО нельзя использовать цифры', success: null, form, roles });
  }

  if (username.length < 3) {
    return res.render('register', { error: 'Логин должен содержать минимум 3 символа', success: null, form, roles });
  }

  if (password.length < 6) {
    return res.render('register', { error: 'Пароль должен содержать минимум 6 символов', success: null, form, roles });
  }

  if (password !== password_repeat) {
    return res.render('register', { error: 'Пароли не совпадают', success: null, form, roles });
  }

  const allowedRole = roles.find(role => String(role.id) === String(role_id));
  if (!allowedRole) {
    return res.render('register', { error: 'Выберите корректную роль пользователя', success: null, form, roles });
  }

  const exists = await query('SELECT id FROM users WHERE username=?', [username]);
  if (exists.length) {
    return res.render('register', { error: 'Пользователь с таким логином уже существует', success: null, form, roles });
  }

  const result = await query('INSERT INTO users(role_id, username, password_hash, full_name) VALUES(?,?,?,?)', [role_id, username, hashPassword(password), full_name]);

  req.session.user = {
    id: result.insertId,
    username,
    full_name,
    role: allowedRole.name,
    role_title: allowedRole.title
  };

  await logAction(req, 'Регистрация в системе', 'users', result.insertId);
  res.redirect('/');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = await query(`SELECT u.id, u.username, u.password_hash, u.full_name, r.name AS role, r.title AS role_title FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ?`, [username]);
  const user = users[0];
  if (!user || user.password_hash !== hashPassword(password)) return res.render('login', { error: 'Неверный логин или пароль' });
  req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role, role_title: user.role_title };
  await logAction(req, 'Вход в систему', 'users', user.id);
  res.redirect('/');
});

app.get('/logout', auth, async (req, res) => {
  await logAction(req, 'Выход из системы', 'users', req.session.user.id);
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', auth, async (req, res) => {
  const stats = {
    students: (await query('SELECT COUNT(*) AS total FROM students WHERE status = "active"'))[0].total,
    absent: (await query('SELECT COUNT(*) AS total FROM attendance WHERE status IN ("absent","late") AND MONTH(lesson_date)=MONTH(CURDATE()) AND YEAR(lesson_date)=YEAR(CURDATE())'))[0].total,
    badGrades: (await query('SELECT COUNT(*) AS total FROM grades WHERE grade_value IN ("2","н/а")'))[0].total,
    events: (await query('SELECT COUNT(*) AS total FROM events WHERE event_date >= CURDATE()'))[0].total
  };
  const recentStudents = await query('SELECT s.*, g.group_name FROM students s JOIN study_groups g ON g.id=s.group_id ORDER BY s.id DESC LIMIT 5');
  const events = await query('SELECT * FROM events WHERE event_date >= CURDATE() ORDER BY event_date ASC LIMIT 5');
  const riskStudents = await query(`SELECT s.id, s.full_name, g.group_name, COUNT(gr.id) AS bad_count FROM students s JOIN study_groups g ON g.id=s.group_id JOIN grades gr ON gr.student_id=s.id WHERE gr.grade_value IN ('2','н/а') GROUP BY s.id ORDER BY bad_count DESC LIMIT 5`);
  const activity = req.session.user.role === 'admin'
    ? await query(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 6`)
    : [];
  res.render('index', { stats, recentStudents, events, riskStudents, activity });
});

app.get('/students', auth, async (req, res) => {
  const search = req.query.search || '';
  const group_id = req.query.group_id || '';
  const status = req.query.status || '';
  const groups = await query('SELECT * FROM study_groups ORDER BY group_name');
  const params = [`%${search}%`];
  let where = 'WHERE s.full_name LIKE ?';
  if (group_id) { where += ' AND s.group_id=?'; params.push(group_id); }
  if (status) { where += ' AND s.status=?'; params.push(status); }
  const students = await query(`SELECT s.*, g.group_name FROM students s JOIN study_groups g ON g.id=s.group_id ${where} ORDER BY s.full_name`, params);
  res.render('students/index', { students, search, groups, group_id, status });
});

app.get('/students/create', auth, canEdit, async (req, res) => {
  await renderStudentForm(res, {}, 'Добавление студента');
});

app.post('/students/create', auth, canEdit, async (req, res) => {
  const { group_id, full_name, birth_date, phone, email, address, status, notes } = req.body;
  if (!isValidFullName(full_name)) {
    return renderStudentForm(res, req.body, 'Добавление студента', 'В ФИО нельзя использовать цифры');
  }
  const result = await query('INSERT INTO students(group_id, full_name, birth_date, phone, email, address, status, notes) VALUES(?,?,?,?,?,?,?,?)', [group_id, full_name, birth_date || null, phone, email, address, status, notes]);
  await logAction(req, 'Создание студента', 'students', result.insertId);
  res.redirect('/students/' + result.insertId);
});

app.get('/students/:id', auth, async (req, res) => {
  const student = (await query('SELECT s.*, g.group_name FROM students s JOIN study_groups g ON g.id=s.group_id WHERE s.id=?', [req.params.id]))[0];
  if (!student) return res.status(404).send('Студент не найден');
  const parents = await query('SELECT * FROM parents WHERE student_id=? ORDER BY id DESC', [req.params.id]);
  const grades = await query('SELECT gr.*, sub.name AS subject_name FROM grades gr JOIN subjects sub ON sub.id=gr.subject_id WHERE gr.student_id=? ORDER BY gr.grade_date DESC', [req.params.id]);
  const attendance = await query('SELECT a.*, sub.name AS subject_name FROM attendance a JOIN subjects sub ON sub.id=a.subject_id WHERE a.student_id=? ORDER BY a.lesson_date DESC LIMIT 20', [req.params.id]);
  res.render('students/show', { student, parents, grades, attendance });
});

app.get('/students/:id/edit', auth, canEdit, async (req, res) => {
  const student = (await query('SELECT * FROM students WHERE id=?', [req.params.id]))[0];
  await renderStudentForm(res, student, 'Редактирование студента');
});

app.post('/students/:id/edit', auth, canEdit, async (req, res) => {
  const { group_id, full_name, birth_date, phone, email, address, status, notes } = req.body;
  if (!isValidFullName(full_name)) {
    return renderStudentForm(res, { ...req.body, id: req.params.id }, 'Редактирование студента', 'В ФИО нельзя использовать цифры');
  }
  await query('UPDATE students SET group_id=?, full_name=?, birth_date=?, phone=?, email=?, address=?, status=?, notes=? WHERE id=?', [group_id, full_name, birth_date || null, phone, email, address, status, notes, req.params.id]);
  await logAction(req, 'Редактирование студента', 'students', req.params.id);
  res.redirect('/students/' + req.params.id);
});

app.post('/students/:id/delete', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM students WHERE id=?', [req.params.id]);
  await logAction(req, 'Удаление студента', 'students', req.params.id);
  res.redirect('/students');
});

app.post('/students/:id/parents', auth, canEdit, async (req, res) => {
  const { full_name, relation_type, phone, email } = req.body;
  if (!isValidFullName(full_name)) return res.status(400).send('В ФИО нельзя использовать цифры');
  await query('INSERT INTO parents(student_id, full_name, relation_type, phone, email) VALUES(?,?,?,?,?)', [req.params.id, full_name, relation_type, phone, email]);
  await logAction(req, 'Добавление родителя', 'parents', req.params.id);
  res.redirect('/students/' + req.params.id);
});

app.get('/attendance', auth, async (req, res) => {
  const group_id = req.query.group_id || '';
  const subject_id = req.query.subject_id || '';
  const lesson_date = req.query.lesson_date || new Date().toISOString().slice(0, 10);
  const groups = await query('SELECT * FROM study_groups ORDER BY group_name');
  const subjects = await query('SELECT * FROM subjects ORDER BY name');
  let students = [];
  let saved = [];
  if (group_id) students = await query('SELECT * FROM students WHERE group_id=? AND status="active" ORDER BY full_name', [group_id]);
  if (subject_id && lesson_date) saved = await query('SELECT * FROM attendance WHERE subject_id=? AND lesson_date=?', [subject_id, lesson_date]);
  const map = Object.fromEntries(saved.map(x => [x.student_id, x]));
  res.render('attendance/index', { groups, subjects, students, map, group_id, subject_id, lesson_date });
});

app.post('/attendance', auth, canEdit, async (req, res) => {
  const { subject_id, lesson_date, student_ids } = req.body;
  const ids = Array.isArray(student_ids) ? student_ids : [student_ids].filter(Boolean);
  for (const id of ids) {
    const status = req.body['status_' + id] || 'present';
    const comment = req.body['comment_' + id] || '';
    await query('INSERT INTO attendance(student_id, subject_id, lesson_date, status, comment) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status), comment=VALUES(comment)', [id, subject_id, lesson_date, status, comment]);
  }
  await logAction(req, 'Сохранение посещаемости', 'attendance', null);
  res.redirect('/attendance?group_id=' + req.body.group_id + '&subject_id=' + subject_id + '&lesson_date=' + lesson_date);
});

app.get('/grades', auth, async (req, res) => {
  const grades = await query(`SELECT gr.*, s.full_name, sub.name AS subject_name FROM grades gr JOIN students s ON s.id=gr.student_id JOIN subjects sub ON sub.id=gr.subject_id ORDER BY gr.grade_date DESC`);
  const students = await query('SELECT * FROM students WHERE status="active" ORDER BY full_name');
  const subjects = await query('SELECT * FROM subjects ORDER BY name');
  res.render('grades/index', { grades, students, subjects });
});

app.post('/grades', auth, canEdit, async (req, res) => {
  const { student_id, subject_id, grade_value, grade_date, control_type, comment } = req.body;
  const result = await query('INSERT INTO grades(student_id, subject_id, grade_value, grade_date, control_type, comment) VALUES(?,?,?,?,?,?)', [student_id, subject_id, grade_value, grade_date, control_type, comment]);
  await logAction(req, 'Добавление оценки', 'grades', result.insertId);
  res.redirect('/grades');
});

app.post('/grades/:id/delete', auth, canEdit, async (req, res) => {
  await query('DELETE FROM grades WHERE id=?', [req.params.id]);
  await logAction(req, 'Удаление оценки', 'grades', req.params.id);
  res.redirect('/grades');
});

app.get('/events', auth, async (req, res) => {
  const events = await query('SELECT e.*, u.full_name AS creator FROM events e LEFT JOIN users u ON u.id=e.created_by ORDER BY e.event_date DESC');
  res.render('events/index', { events });
});

app.get('/events/create', auth, canEdit, (req, res) => {
  res.render('events/form', { event: {}, title: 'Добавление мероприятия' });
});

app.post('/events/create', auth, canEdit, async (req, res) => {
  const { title, event_date, event_type, event_place, organizer, target_audience, description, result } = req.body;
  const created = await query('INSERT INTO events(title, event_date, event_type, event_place, organizer, target_audience, description, result, created_by) VALUES(?,?,?,?,?,?,?,?,?)', [title, event_date, event_type, event_place, organizer, target_audience, description, result, req.session.user.id]);
  await logAction(req, 'Создание мероприятия', 'events', created.insertId);
  res.redirect('/events/' + created.insertId);
});

app.get('/events/:id', auth, async (req, res) => {
  const event = (await query('SELECT * FROM events WHERE id=?', [req.params.id]))[0];
  const participants = await query('SELECT ep.*, s.full_name FROM event_participants ep JOIN students s ON s.id=ep.student_id WHERE ep.event_id=? ORDER BY s.full_name', [req.params.id]);
  const students = await query('SELECT * FROM students WHERE status="active" ORDER BY full_name');
  res.render('events/show', { event, participants, students });
});

app.post('/events/:id/participants', auth, canEdit, async (req, res) => {
  const { student_id, participation_status } = req.body;
  await query('INSERT INTO event_participants(event_id, student_id, participation_status) VALUES(?,?,?) ON DUPLICATE KEY UPDATE participation_status=VALUES(participation_status)', [req.params.id, student_id, participation_status]);
  await logAction(req, 'Добавление участника мероприятия', 'event_participants', req.params.id);
  res.redirect('/events/' + req.params.id);
});

app.post('/events/:eventId/participants/:participantId/delete', auth, canEdit, async (req, res) => {
  await query('DELETE FROM event_participants WHERE id=? AND event_id=?', [req.params.participantId, req.params.eventId]);
  await logAction(req, 'Удаление участника мероприятия', 'event_participants', req.params.participantId);
  res.redirect('/events/' + req.params.eventId);
});

app.get('/subjects', auth, async (req, res) => {
  const subjects = await query('SELECT sub.*, g.group_name FROM subjects sub JOIN study_groups g ON g.id=sub.group_id ORDER BY g.group_name, sub.name');
  const groups = await query('SELECT * FROM study_groups ORDER BY group_name');
  res.render('subjects/index', { subjects, groups });
});

app.post('/subjects', auth, canEdit, async (req, res) => {
  const { group_id, name, teacher_name } = req.body;
  await query('INSERT INTO subjects(group_id, name, teacher_name) VALUES(?,?,?)', [group_id, name, teacher_name]);
  await logAction(req, 'Создание дисциплины', 'subjects', null);
  res.redirect('/subjects');
});


function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function excelDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}

function getCell(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return String(row[name]).trim();
  }
  return '';
}

function excelEscape(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendWorkbook(res, filename, sheetName, header, rows) {
  const data = [header, ...rows];
  const worksheet = xlsx.utils.aoa_to_sheet(data);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  return '"' + String(value).replace(/"/g, '""') + '"';
}

app.get('/reports', auth, async (req, res) => {
  const groupStats = await query('SELECT g.group_name, COUNT(s.id) AS students FROM study_groups g LEFT JOIN students s ON s.group_id=g.id GROUP BY g.id ORDER BY g.group_name');
  const attendanceStats = await query(`SELECT s.full_name, SUM(a.status='absent') AS absent, SUM(a.status='late') AS late, SUM(a.status='valid_absent') AS valid_absent FROM students s LEFT JOIN attendance a ON a.student_id=s.id GROUP BY s.id ORDER BY s.full_name`);
  const riskStudents = await query(`SELECT s.full_name, COUNT(gr.id) AS bad_count FROM students s JOIN grades gr ON gr.student_id=s.id WHERE gr.grade_value IN ('2','н/а') GROUP BY s.id HAVING bad_count > 0 ORDER BY bad_count DESC`);
  const eventStats = await query('SELECT event_type, COUNT(*) AS total FROM events GROUP BY event_type ORDER BY total DESC');
  const activity = req.session.user.role === 'admin'
    ? await query(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 10`)
    : [];
  res.render('reports/index', { groupStats, attendanceStats, riskStudents, eventStats, activity, importMessage: req.query.imported || null, importError: req.query.error || null });
});

app.get('/reports/students.csv', auth, async (req, res) => {
  const rows = await query(`SELECT s.full_name, g.group_name, s.birth_date, s.phone, s.email, s.address, s.status FROM students s JOIN study_groups g ON g.id=s.group_id ORDER BY g.group_name, s.full_name`);
  const header = ['ФИО','Группа','Дата рождения','Телефон','Email','Адрес','Статус'];
  const body = rows.map(r => [r.full_name, r.group_name, r.birth_date ? r.birth_date.toISOString().slice(0,10) : '', r.phone, r.email, r.address, labelByMap(statusLabels, r.status)].map(csvEscape).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=students.csv');
  res.send('﻿' + header.map(csvEscape).join(';') + '\n' + body.join('\n'));
});

app.get('/reports/attendance.csv', auth, async (req, res) => {
  const rows = await query(`SELECT s.full_name, sub.name AS subject_name, a.lesson_date, a.status, a.comment FROM attendance a JOIN students s ON s.id=a.student_id JOIN subjects sub ON sub.id=a.subject_id ORDER BY a.lesson_date DESC, s.full_name`);
  const header = ['Студент','Дисциплина','Дата','Статус','Комментарий'];
  const body = rows.map(r => [r.full_name, r.subject_name, r.lesson_date ? r.lesson_date.toISOString().slice(0,10) : '', labelByMap(attendanceLabels, r.status), r.comment].map(csvEscape).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=attendance.csv');
  res.send('﻿' + header.map(csvEscape).join(';') + '\n' + body.join('\n'));
});


app.get('/reports/students.xlsx', auth, async (req, res) => {
  const rows = await query(`SELECT s.full_name, g.group_name, s.birth_date, s.phone, s.email, s.address, s.status, s.notes FROM students s JOIN study_groups g ON g.id=s.group_id ORDER BY g.group_name, s.full_name`);
  sendWorkbook(res, 'students.xlsx', 'Студенты', ['ФИО','Группа','Дата рождения','Телефон','Email','Адрес','Статус','Примечание'], rows.map(r => [r.full_name, r.group_name, formatDate(r.birth_date), r.phone, r.email, r.address, labelByMap(statusLabels, r.status), r.notes]));
});

app.get('/reports/attendance.xlsx', auth, async (req, res) => {
  const rows = await query(`SELECT s.full_name, sub.name AS subject_name, a.lesson_date, a.status, a.comment FROM attendance a JOIN students s ON s.id=a.student_id JOIN subjects sub ON sub.id=a.subject_id ORDER BY a.lesson_date DESC, s.full_name`);
  sendWorkbook(res, 'attendance.xlsx', 'Посещаемость', ['Студент','Дисциплина','Дата','Статус','Комментарий'], rows.map(r => [r.full_name, r.subject_name, formatDate(r.lesson_date), labelByMap(attendanceLabels, r.status), r.comment]));
});

app.get('/reports/grades.xlsx', auth, async (req, res) => {
  const rows = await query(`SELECT s.full_name, sub.name AS subject_name, gr.grade_value, gr.grade_date, gr.control_type, gr.comment FROM grades gr JOIN students s ON s.id=gr.student_id JOIN subjects sub ON sub.id=gr.subject_id ORDER BY gr.grade_date DESC, s.full_name`);
  sendWorkbook(res, 'grades.xlsx', 'Успеваемость', ['Студент','Дисциплина','Оценка','Дата','Тип контроля','Комментарий'], rows.map(r => [r.full_name, r.subject_name, r.grade_value, formatDate(r.grade_date), r.control_type, r.comment]));
});

app.get('/reports/events.xlsx', auth, async (req, res) => {
  const rows = await query(`SELECT title, event_date, event_type, event_place, organizer, target_audience, description, result FROM events ORDER BY event_date DESC`);
  sendWorkbook(res, 'events.xlsx', 'Мероприятия', ['Название','Дата','Тип','Место','Ответственный','Аудитория','Описание','Результат'], rows.map(r => [r.title, formatDate(r.event_date), r.event_type, r.event_place, r.organizer, r.target_audience, r.description, r.result]));
});

app.get('/reports/students-template.xlsx', auth, canEdit, async (req, res) => {
  sendWorkbook(res, 'students_template.xlsx', 'Студенты', ['ФИО','Группа','Дата рождения','Телефон','Email','Адрес','Статус','Примечание'], [['Иванов Иван Иванович','ИС-21','2007-04-15','+7 900 000-00-00','ivanov@example.com','г. Казань, ул. Учебная, 1','Активно обучается','пример строки']]);
});

app.post('/reports/import-students', auth, canEdit, upload.single('excel_file'), async (req, res) => {
  if (!req.file) return res.redirect('/reports?error=' + encodeURIComponent('Выберите Excel-файл для импорта'));
  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return res.redirect('/reports?error=' + encodeURIComponent('В файле нет строк для импорта'));

    let imported = 0;
    for (const row of rows) {
      const fullName = getCell(row, ['ФИО', 'Фамилия Имя Отчество', 'full_name']);
      const groupName = getCell(row, ['Группа', 'group_name']);
      if (!fullName || !groupName || !isValidFullName(fullName)) continue;

      let group = (await query('SELECT id FROM study_groups WHERE group_name=?', [groupName]))[0];
      if (!group) {
        const createdGroup = await query('INSERT INTO study_groups(group_name, specialty, course_number, study_year, curator_id) VALUES(?,?,?,?,?)', [groupName, 'Не указано', 1, String(new Date().getFullYear()) + '-' + String(new Date().getFullYear() + 1), req.session.user.id]);
        group = { id: createdGroup.insertId };
      }

      const statusText = getCell(row, ['Статус', 'status']).toLowerCase();
      const status = statusText.includes('академ') ? 'academic_leave' : statusText.includes('отчис') ? 'expelled' : statusText.includes('выпуск') ? 'graduated' : 'active';
      const birthDate = excelDate(row['Дата рождения'] || row.birth_date);
      const phone = getCell(row, ['Телефон', 'phone']);
      const email = getCell(row, ['Email', 'email']);
      const address = getCell(row, ['Адрес', 'address']);
      const notes = getCell(row, ['Примечание', 'notes']);

      await query('INSERT INTO students(group_id, full_name, birth_date, phone, email, address, status, notes) VALUES(?,?,?,?,?,?,?,?)', [group.id, fullName, birthDate, phone, email, address, status, notes]);
      imported++;
    }

    await logAction(req, 'Импорт студентов из Excel', 'students', null);
    res.redirect('/reports?imported=' + encodeURIComponent('Импортировано строк: ' + imported));
  } catch (error) {
    res.redirect('/reports?error=' + encodeURIComponent('Не удалось прочитать Excel-файл. Проверьте структуру колонок.'));
  }
});

app.get('/admin/users', auth, adminOnly, async (req, res) => {
  const users = await query('SELECT u.*, r.title AS role_title FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.full_name');
  const roles = await query('SELECT * FROM roles ORDER BY id');
  res.render('admin/users', { users, roles });
});

app.post('/admin/users', auth, adminOnly, async (req, res) => {
  const { role_id, username, password, full_name } = req.body;
  if (!isValidFullName(full_name)) return res.status(400).send('В ФИО нельзя использовать цифры');
  await query('INSERT INTO users(role_id, username, password_hash, full_name) VALUES(?,?,?,?)', [role_id, username, hashPassword(password), full_name]);
  await logAction(req, 'Создание пользователя', 'users', null);
  res.redirect('/admin/users');
});

app.listen(port, () => {
  console.log('Сервер запущен: http://localhost:' + port);
});
