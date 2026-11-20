export type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced';

export type ArabicFontStyle = 'scheherazade' | 'amiri' | 'naskh';

export type PracticeStatus = 'needs_review' | 'learned';

export type SrsRating = 'hard' | 'good' | 'easy';

export type ActiveTab = 'lessons' | 'history' | 'vocabulary' | 'practice';

export type UserRole = 'student' | 'teacher';

export type LessonContentType = 'text' | 'video';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isGuest?: boolean;
  createdAt: number;
}

export interface SentencePair {
  arabic: string;
  english: string;
  contextLabel?: string;
}

export interface WordAnalysis {
  word: string;
  wordWithTashkeel: string;
  partOfSpeech: string;
  wordType?: string;
  root?: string;
  transliteration: string;
  englishMeaning: string;
  examples: SentencePair[];
  source?: 'gemini' | 'lexicon' | 'cache';
  notice?: string;
}

export interface VocabCard extends WordAnalysis {
  id: string;
  normalizedKey: string;
  lessonId?: string;
  lessonTitle?: string;
  status: PracticeStatus;
  createdAt: number;
  lastReviewedAt?: number;
  srsRating?: SrsRating;
  nextReviewAt?: number;
  intervalDays?: number;
  reviewCount?: number;
}

export interface TranscriptSegment {
  id: string;
  startSec: number;
  endSec: number;
  textAr: string;
}

export interface Lesson {
  id: string;
  titleEn: string;
  titleAr: string;
  level: ProficiencyLevel;
  description: string;
  contentType?: LessonContentType;
  youtubeUrl?: string;
  videoDurationSeconds?: number;
  transcriptSegments?: TranscriptSegment[];
  readingTimeMinutes: number;
  textAr: string;
  isCustom?: boolean;
  authorName?: string;
  authorId?: string;
  createdAt?: number;
}

export interface ReaderPreferences {
  showTashkeel: boolean;
  fontSize: number; // px, e.g. 24 to 46
  fontStyle: ArabicFontStyle;
  speechRate: number; // 0.75 or 1.0
}

export interface StudyStreak {
  count: number;
  lastActivityDate: string | null; // Local YYYY-MM-DD
}

export interface LessonQuizQuestion {
  id: string;
  questionEn: string;
  questionAr: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface LessonQuizResponse {
  questions: LessonQuizQuestion[];
  source: 'gemini' | 'fallback';
  notice?: string;
}

export interface ReadingHistoryItem {
  lessonId: string;
  titleEn: string;
  titleAr: string;
  level: ProficiencyLevel;
  lastReadAt: number;
  progressPercent: number;
  wordsInteracted: number;
  totalWords: number;
  audioListened?: boolean;
  quizCompleted?: boolean;
  quizScore?: { correct: number; total: number };
}

export interface NoteContextTag {
  type: 'lesson' | 'vocab' | 'general';
  label: string;
  refId?: string;
}

export interface StudyNote {
  id: string;
  title?: string;
  body: string;
  context?: NoteContextTag;
  createdAt: number;
  updatedAt: number;
}
