/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-07 12:00:00 | roger.murphy@agenticfederal.us   | Documentation backfill: added file-header change log block
 */

-- =============================================================================
-- Migration 019: Little Monsters Education Platform
-- Date: 2026-04-19
-- Author: roger.murphy@emeraldcoastsystemsgroup.com
-- Description: Tables for students, classes, enrollments, flashcards, XP,
--              assignments, and quiz results. Powers the Little Monsters
--              education application on OSHAL.
-- =============================================================================

-- ─── Classes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_classes (
  class_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(100) NOT NULL,
  grade_level VARCHAR(20),
  teacher_name VARCHAR(255),
  description TEXT DEFAULT '',
  chroma_collection_prefix VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_classes_status ON lm_classes(status);

-- ─── Students ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_students (
  student_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_students_email ON lm_students(email);

-- ─── Enrollments (student <-> class) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_enrollments (
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES lm_classes(class_id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, class_id)
);

-- ─── Flashcard Sets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_flashcard_sets (
  set_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES lm_classes(class_id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  topic VARCHAR(100),
  source_type VARCHAR(30) DEFAULT 'lecture'
    CHECK (source_type IN ('lecture', 'textbook', 'manual', 'quiz-review')),
  source_reference VARCHAR(500),
  card_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_flashcard_sets_class ON lm_flashcard_sets(class_id);

-- ─── Flashcards ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_flashcards (
  card_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES lm_flashcard_sets(set_id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  card_type VARCHAR(20) NOT NULL DEFAULT 'concept'
    CHECK (card_type IN ('term', 'concept', 'formula', 'fill-blank')),
  difficulty INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  topic VARCHAR(100),
  hints JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_flashcards_set ON lm_flashcards(set_id);

-- ─── Flashcard Progress (per student per card — SM-2 spaced repetition) ──────
CREATE TABLE IF NOT EXISTS lm_flashcard_progress (
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES lm_flashcards(card_id) ON DELETE CASCADE,
  repetitions INTEGER NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 1,
  next_review DATE NOT NULL DEFAULT CURRENT_DATE,
  last_reviewed TIMESTAMPTZ,
  PRIMARY KEY (student_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_lm_fc_progress_review ON lm_flashcard_progress(student_id, next_review);

-- ─── Assignments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES lm_classes(class_id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT '',
  assignment_type VARCHAR(30) NOT NULL DEFAULT 'homework'
    CHECK (assignment_type IN ('homework', 'reading', 'project', 'lab', 'quiz-prep', 'test')),
  due_date DATE,
  source_lecture_date DATE,
  resources JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_assignments_class ON lm_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_lm_assignments_due ON lm_assignments(due_date);

-- ─── XP Events ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_xp_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  xp_amount INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_xp_events_student ON lm_xp_events(student_id);

-- ─── Quiz Results ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_quiz_results (
  result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  class_id UUID REFERENCES lm_classes(class_id) ON DELETE SET NULL,
  score_percent INTEGER NOT NULL CHECK (score_percent BETWEEN 0 AND 100),
  total_questions INTEGER NOT NULL,
  correct_answers INTEGER NOT NULL,
  topics JSONB NOT NULL DEFAULT '[]',
  missed_questions JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_quiz_results_student ON lm_quiz_results(student_id);

-- ─── Lecture Recordings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_lectures (
  lecture_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES lm_classes(class_id) ON DELETE CASCADE,
  lecture_date DATE NOT NULL DEFAULT CURRENT_DATE,
  audio_path VARCHAR(500),
  transcript_path VARCHAR(500),
  notes_path VARCHAR(500),
  assignments_path VARCHAR(500),
  flashcard_set_id UUID REFERENCES lm_flashcard_sets(set_id),
  ticket_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_lectures_class ON lm_lectures(class_id);
CREATE INDEX IF NOT EXISTS idx_lm_lectures_status ON lm_lectures(status);
