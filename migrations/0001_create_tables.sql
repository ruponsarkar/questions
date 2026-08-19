-- Initial schema for questions app
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY,
    subName TEXT,
    class TEXT,
    details TEXT,
    examName TEXT,
    image TEXT,
    status INTEGER,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS syllabuses (
    id INTEGER PRIMARY KEY,
    syllabus TEXT,
    subject_id INTEGER,
    type TEXT,
    self_id INTEGER,
    exam_id INTEGER,
    isActive INTEGER,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    email TEXT,
    phoneNumber TEXT,
    role TEXT,
    isActive INTEGER,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
    q_id INTEGER PRIMARY KEY,
    difficulties TEXT,
    question TEXT,
    class TEXT,
    description TEXT,
    desc_type TEXT,
    isApprove INTEGER,
    type INTEGER,
    subject_id INTEGER,
    syllabus_id INTEGER,
    addedBy_id INTEGER
);

CREATE TABLE IF NOT EXISTS answers (
    ans_id INTEGER PRIMARY KEY,
    answer TEXT,
    question_type INTEGER,
    q_id INTEGER,
    isRight INTEGER,
    created_at TEXT,
    updated_at TEXT
);

COMMIT;
