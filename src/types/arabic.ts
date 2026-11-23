export type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced';

export type ArabicFontStyle = 'scheherazade' | 'amiri' | 'naskh';

export type PracticeStatus = 'needs_review' | 'learned';

export type SrsRating = 'hard' | 'good' | 'easy';

export type ActiveTab = 'lessons' | 'vocabulary' | 'exams' | 'conversation' | 'history';

export type LessonContentType = 'text' | 'video';

export type UserRole = 'student' | 'moderator' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role?: UserRole;
  isPrimaryOwner?: boolean;
  isGuest?: boolean;
  createdAt: number;
}

export interface AdminManagedAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isPrimaryOwner: boolean;
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
  vocalizedWord?: string;
  partOfSpeech: string;
  wordType?: string;
  root?: string;
  transliteration: string;
  englishMeaning: string;
  examples: SentencePair[];
  level?: ProficiencyLevel;
  source?: 'gemini' | 'lexicon' | 'cache';
  notice?: string;
}

export interface VocabCard extends WordAnalysis {
  id: string;
  normalizedKey: string;
  lessonId?: string;
  lessonTitle?: string;
  level?: ProficiencyLevel;
  status: PracticeStatus;
  createdAt: number;
  lastReviewedAt?: number;
  srsRating?: SrsRating;
  nextReviewAt?: number;
  intervalDays?: number;
  reviewCount?: number;
  hasCustomEdits?: boolean;
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

export interface ExamQuestion {
  id: string;
  type: 'meaning' | 'fill_blank' | 'usage';
  targetCardId?: string;
  targetWordAr: string;
  promptAr: string;
  promptEn: string;
  contextSentenceAr?: string;
  options: string[];
  correctIndex: number;
  explanationEn: string;
  explanationAr: string;
}

export interface GeneratedExam {
  titleEn: string;
  titleAr: string;
  level: ProficiencyLevel;
  questions: ExamQuestion[];
  source: 'gemini' | 'fallback';
  notice?: string;
}

export interface ConversationDialogueTurn {
  id: string;
  speakerAr: string;
  speakerEn: string;
  role: 'learner' | 'partner';
  arabic: string;
  transliteration: string;
  english: string;
  usedWords: string[];
}

export interface ConversationPracticeSentence {
  id: string;
  arabic: string;
  english: string;
  focusWordAr: string;
  tipEn: string;
}

export interface GeneratedConversation {
  scenarioId: string;
  titleAr: string;
  titleEn: string;
  settingAr: string;
  settingEn: string;
  level: ProficiencyLevel;
  targetWords: string[];
  turns: ConversationDialogueTurn[];
  practiceSentences: ConversationPracticeSentence[];
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
  type: 'lesson' | 'vocab' | 'exam' | 'conversation' | 'general';
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
