import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Minus,
  NotebookPen,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Sparkles,
  Square,
  Video,
  Volume2,
  XCircle,
} from 'lucide-react';
import {
  Lesson,
  LessonQuizQuestion,
  LessonQuizResponse,
  NoteContextTag,
  ReaderPreferences,
  ReadingHistoryItem,
  TranscriptSegment,
  VocabCard,
} from '../types/arabic';
import {
  applySmartPartialTashkeel,
  countArabicWords,
  extractYouTubeVideoId,
  formatTimestamp,
  getArabicFontClass,
  LEVEL_LABELS,
  normalizeArabicWord,
  speakArabic,
  stopArabicSpeech,
  stripTashkeel,
  TextToken,
  tokenizeArabicParagraph,
} from '../utils/arabic';
import { ActiveWordSelection } from './WordContextMenu';
import { YouTubePlayer, VideoTimeSyncInfo } from './YouTubePlayer';

interface LessonReaderProps {
  lesson: Lesson;
  preferences: ReaderPreferences;
  onUpdatePreferences: (prefs: ReaderPreferences) => void;
  vocabStatusMap: Map<string, VocabCard['status']>;
  activeWordKey: string | null;
  onSelectWord: (selection: ActiveWordSelection) => void;
  onBackToList: () => void;
  onUpdateReadingHistory?: (item: Partial<ReadingHistoryItem> & { lessonId: string }) => void;
  notesCount?: number;
  onOpenNotes?: (context?: NoteContextTag) => void;
}

interface SentenceWordRange {
  wordIndex: number;
  startChar: number;
  endChar: number;
  charLength: number;
}

interface ParsedSentence {
  sentenceIndex: number;
  rawText: string;
  spokenText: string;
  tokens: Array<TextToken & { spokenWordIndex: number | null }>;
  wordRanges: SentenceWordRange[];
}

interface ParsedParagraph {
  paragraphIndex: number;
  rawText: string;
  sentences: ParsedSentence[];
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.؟!؛]+(?:[.؟!؛]+|$)/g);
  if (!matches) return [paragraph];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

function buildLessonStructure(paragraphs: string[]): {
  parsedParagraphs: ParsedParagraph[];
  allSentences: ParsedSentence[];
} {
  const allSentences: ParsedSentence[] = [];
  const parsedParagraphs: ParsedParagraph[] = paragraphs.map((paragraph, pIndex) => {
    const rawSentences = splitParagraphIntoSentences(paragraph);
    const sentences: ParsedSentence[] = rawSentences.map((sentenceText) => {
      const sentenceIndex = allSentences.length;
      const baseTokens = tokenizeArabicParagraph(sentenceText, pIndex * 100 + sentenceIndex);

      let spokenCursor = 0;
      const spokenPieces: string[] = [];
      const wordRanges: SentenceWordRange[] = [];

      const tokens = baseTokens.map((tok) => {
        if (tok.isArabicWord) {
          const wordIndex = wordRanges.length;
          const cleanWord = tok.core;
          const ttsWord = stripTashkeel(cleanWord);
          const startChar = spokenCursor;
          const endChar = startChar + ttsWord.length;
          wordRanges.push({
            wordIndex,
            startChar,
            endChar,
            charLength: Math.max(2, ttsWord.length),
          });
          spokenPieces.push(cleanWord);
          spokenCursor = endChar + 1;
          return { ...tok, spokenWordIndex: wordIndex };
        }
        return { ...tok, spokenWordIndex: null };
      });

      const parsed: ParsedSentence = {
        sentenceIndex,
        rawText: sentenceText,
        spokenText: spokenPieces.length > 0 ? spokenPieces.join(' ') : sentenceText,
        tokens,
        wordRanges,
      };
      allSentences.push(parsed);
      return parsed;
    });

    return {
      paragraphIndex: pIndex,
      rawText: paragraph,
      sentences,
    };
  });

  return { parsedParagraphs, allSentences };
}

export function LessonReader({
  lesson,
  preferences,
  onUpdatePreferences,
  vocabStatusMap,
  activeWordKey,
  onSelectWord,
  onBackToList,
  onUpdateReadingHistory,
  notesCount = 0,
  onOpenNotes,
}: LessonReaderProps) {
  const [showVideo, setShowVideo] = useState(Boolean(lesson.youtubeUrl));

  // Karaoke synchronized audio state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeSentenceIdx, setActiveSentenceIdx] = useState<number | null>(null);
  const [activeWordIdx, setActiveWordIdx] = useState<number | null>(null);
  const [hasListenedAudio, setHasListenedAudio] = useState(false);

  // Interacted words tracker for reading history progress
  const [interactedWordKeys, setInteractedWordKeys] = useState<Set<string>>(new Set());

  // AI Comprehension Quiz state
  const [quizQuestions, setQuizQuestions] = useState<LessonQuizQuestion[] | null>(null);
  const [quizSource, setQuizSource] = useState<'gemini' | 'fallback' | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});

  // Video timeline synchronization state
  const [videoSync, setVideoSync] = useState<VideoTimeSyncInfo>({
    currentTime: 0,
    duration: lesson.videoDurationSeconds || 240,
    isPlaying: false,
    playerState: 'unstarted',
    wasSeek: false,
  });
  const [autoScrollSync, setAutoScrollSync] = useState(true);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; nonce: number } | null>(null);

  const playbackSessionRef = useRef(0);
  const fallbackTimerRef = useRef<number | null>(null);
  const lastBoundaryAtRef = useRef<number>(0);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const lastScrolledSegRef = useRef<number | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);

  const youtubeVideoId = extractYouTubeVideoId(lesson.youtubeUrl);
  const hasVideoUrl = lesson.contentType !== 'text' && Boolean(youtubeVideoId);

  const rawParagraphs = useMemo(
    () => lesson.textAr.split(/\n\s*\n/).filter((p) => p.trim().length > 0),
    [lesson.textAr]
  );

  const effectiveSegments = useMemo<TranscriptSegment[]>(() => {
    if (!hasVideoUrl) return [];
    if (lesson.transcriptSegments && lesson.transcriptSegments.length > 0) {
      return lesson.transcriptSegments;
    }
    if (rawParagraphs.length === 0) {
      return [];
    }

    const totalDur = Math.max(
      lesson.videoDurationSeconds || 0,
      videoSync.duration || 0,
      rawParagraphs.length * 15,
      180
    );
    const weights = rawParagraphs.map((p) => Math.max(12, stripTashkeel(p).length));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    let cursor = 0;
    return rawParagraphs.map((textAr, idx) => {
      const span = (weights[idx] / Math.max(1, totalWeight)) * totalDur;
      const startSec = Number(cursor.toFixed(1));
      const endSec =
        idx === rawParagraphs.length - 1
          ? Number(totalDur.toFixed(1))
          : Number((cursor + span).toFixed(1));
      cursor += span;
      return {
        id: `seg-${idx + 1}`,
        startSec,
        endSec: Math.max(startSec + 1, endSec),
        textAr,
      };
    });
  }, [hasVideoUrl, lesson.transcriptSegments, lesson.videoDurationSeconds, rawParagraphs, videoSync.duration]);

  const paragraphs = useMemo(
    () =>
      effectiveSegments.length > 0
        ? effectiveSegments.map((seg) => seg.textAr)
        : rawParagraphs,
    [effectiveSegments, rawParagraphs]
  );

  const wordCount = useMemo(
    () => countArabicWords(lesson.textAr || paragraphs.join('\n\n')),
    [lesson.textAr, paragraphs]
  );

  const { parsedParagraphs, allSentences } = useMemo(
    () => buildLessonStructure(paragraphs),
    [paragraphs]
  );

  const isVideoSyncActive = Boolean(
    hasVideoUrl &&
      showVideo &&
      effectiveSegments.length > 0 &&
      !isSpeaking &&
      (videoSync.isPlaying ||
        videoSync.playerState === 'paused' ||
        videoSync.playerState === 'buffering' ||
        videoSync.currentTime > 0)
  );

  const activeVideoSegmentIdx = useMemo<number | null>(() => {
    if (!isVideoSyncActive || effectiveSegments.length === 0) return null;
    const t = videoSync.currentTime;
    const exact = effectiveSegments.findIndex(
      (seg) => t >= seg.startSec && t < seg.endSec
    );
    if (exact !== -1) return exact;
    if (t < effectiveSegments[0].startSec) return 0;
    return effectiveSegments.length - 1;
  }, [isVideoSyncActive, effectiveSegments, videoSync.currentTime]);

  const activeVideoWordTarget = useMemo<{
    segmentIdx: number;
    sentenceIndex: number;
    wordIndex: number;
    flatWordOrder: number;
  } | null>(() => {
    if (activeVideoSegmentIdx === null) return null;
    const seg = effectiveSegments[activeVideoSegmentIdx];
    const paragraph = parsedParagraphs[activeVideoSegmentIdx];
    if (!seg || !paragraph) return null;

    const flatWords: Array<{
      sentenceIndex: number;
      wordIndex: number;
      weight: number;
    }> = [];

    for (const sentence of paragraph.sentences) {
      for (const range of sentence.wordRanges) {
        flatWords.push({
          sentenceIndex: sentence.sentenceIndex,
          wordIndex: range.wordIndex,
          weight: range.charLength + 2,
        });
      }
    }

    if (flatWords.length === 0) return null;

    const span = Math.max(0.5, seg.endSec - seg.startSec);
    const progress = Math.max(
      0,
      Math.min(0.9999, (videoSync.currentTime - seg.startSec) / span)
    );
    const totalWeight = flatWords.reduce((acc, w) => acc + w.weight, 0);
    const targetWeight = progress * totalWeight;

    let acc = 0;
    let chosenIdx = flatWords.length - 1;
    for (let i = 0; i < flatWords.length; i += 1) {
      acc += flatWords[i].weight;
      if (targetWeight <= acc) {
        chosenIdx = i;
        break;
      }
    }

    return {
      segmentIdx: activeVideoSegmentIdx,
      sentenceIndex: flatWords[chosenIdx].sentenceIndex,
      wordIndex: flatWords[chosenIdx].wordIndex,
      flatWordOrder: chosenIdx,
    };
  }, [activeVideoSegmentIdx, effectiveSegments, parsedParagraphs, videoSync.currentTime]);

  const levelMeta = LEVEL_LABELS[lesson.level];
  const currentRate = preferences.speechRate <= 0.85 ? 0.75 : 1;

  // Sync initial reading history on open
  useEffect(() => {
    onUpdateReadingHistory?.({
      lessonId: lesson.id,
      titleEn: lesson.titleEn,
      titleAr: lesson.titleAr,
      level: lesson.level,
      lastReadAt: Date.now(),
      totalWords: wordCount,
      wordsInteracted: 0,
      progressPercent: 10,
    });
  }, [lesson.id, lesson.level, lesson.titleAr, lesson.titleEn, onUpdateReadingHistory, wordCount]);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const stopKaraoke = useCallback(() => {
    playbackSessionRef.current += 1;
    clearFallbackTimer();
    stopArabicSpeech();
    setIsSpeaking(false);
    setActiveSentenceIdx(null);
    setActiveWordIdx(null);
  }, [clearFallbackTimer]);

  useEffect(() => {
    setShowVideo(lesson.contentType !== 'text' && Boolean(extractYouTubeVideoId(lesson.youtubeUrl)));
    stopKaraoke();
    setVideoSync({
      currentTime: 0,
      duration: lesson.videoDurationSeconds || 240,
      isPlaying: false,
      playerState: 'unstarted',
      wasSeek: false,
    });
    setSeekRequest(null);
    lastScrolledSegRef.current = null;
    setQuizQuestions(null);
    setQuizSource(null);
    setQuizError(null);
    setSelectedAnswers({});
    setInteractedWordKeys(new Set());
    setHasListenedAudio(false);
    return () => {
      playbackSessionRef.current += 1;
      clearFallbackTimer();
      stopArabicSpeech();
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, [lesson.id, lesson.youtubeUrl, lesson.videoDurationSeconds, stopKaraoke, clearFallbackTimer]);

  // Auto-scroll smoothly when active video transcript segment changes or user scrubs timeline
  useEffect(() => {
    if (!autoScrollSync || !isVideoSyncActive || activeVideoSegmentIdx === null) return;
    if (lastScrolledSegRef.current !== activeVideoSegmentIdx || videoSync.wasSeek) {
      lastScrolledSegRef.current = activeVideoSegmentIdx;
      segmentRefs.current[activeVideoSegmentIdx]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [autoScrollSync, isVideoSyncActive, activeVideoSegmentIdx, videoSync.wasSeek]);

  const handleVideoTimeSync = useCallback(
    (info: VideoTimeSyncInfo) => {
      if (info.isPlaying && isSpeaking) {
        stopKaraoke();
      }
      setVideoSync(info);
    },
    [isSpeaking, stopKaraoke]
  );

  const handleJumpToSegment = useCallback((startSec: number) => {
    if (isSpeaking) {
      stopKaraoke();
    }
    setShowVideo(true);
    setSeekRequest({ seconds: startSec, nonce: Date.now() });
    setVideoSync((prev) => ({
      ...prev,
      currentTime: startSec,
      wasSeek: true,
    }));
  }, [isSpeaking, stopKaraoke]);

  const speakSentenceAt = useCallback(
    (sentenceIdx: number, rate: number, sessionId: number) => {
      if (playbackSessionRef.current !== sessionId) return;

      if (sentenceIdx >= allSentences.length) {
        stopKaraoke();
        setHasListenedAudio(true);
        const targetPercent = Math.min(
          100,
          Math.max(70, Math.round((interactedWordKeys.size / Math.max(1, wordCount)) * 100) + 40)
        );
        onUpdateReadingHistory?.({
          lessonId: lesson.id,
          lastReadAt: Date.now(),
          audioListened: true,
          progressPercent: targetPercent,
          wordsInteracted: interactedWordKeys.size,
          totalWords: wordCount,
        });
        return;
      }

      const sentence = allSentences[sentenceIdx];
      clearFallbackTimer();

      setIsSpeaking(true);
      setActiveSentenceIdx(sentenceIdx);
      setActiveWordIdx(sentence.wordRanges.length > 0 ? 0 : null);
      lastBoundaryAtRef.current = 0;

      const scheduleWordAdvance = (wordPos: number) => {
        clearFallbackTimer();
        if (playbackSessionRef.current !== sessionId) return;
        if (wordPos + 1 >= sentence.wordRanges.length) return;

        const currentWordLen = sentence.wordRanges[wordPos]?.charLength ?? 4;
        const msPerWord = Math.round((320 + currentWordLen * 48) / rate);

        fallbackTimerRef.current = window.setTimeout(() => {
          if (playbackSessionRef.current !== sessionId) return;
          if (Date.now() - lastBoundaryAtRef.current > 350) {
            setActiveWordIdx(wordPos + 1);
          }
          scheduleWordAdvance(wordPos + 1);
        }, msPerWord);
      };

      let sentenceEnded = false;
      speakArabic(sentence.spokenText, {
        rate,
        onStart: () => {
          if (playbackSessionRef.current !== sessionId) return;
          if (sentence.wordRanges.length > 1) {
            scheduleWordAdvance(0);
          }
        },
        onBoundary: (charIndex) => {
          if (playbackSessionRef.current !== sessionId) return;
          lastBoundaryAtRef.current = Date.now();
          const match = sentence.wordRanges.find(
            (r) => charIndex >= r.startChar && charIndex <= r.endChar + 1
          );
          if (match) {
            setActiveWordIdx(match.wordIndex);
          }
        },
        onEnd: () => {
          clearFallbackTimer();
          if (sentenceEnded || playbackSessionRef.current !== sessionId) return;
          sentenceEnded = true;
          speakSentenceAt(sentenceIdx + 1, rate, sessionId);
        },
        onError: () => {
          clearFallbackTimer();
          if (playbackSessionRef.current !== sessionId) return;
          sentenceEnded = true;
          stopKaraoke();
        },
      });
    },
    [allSentences, clearFallbackTimer, interactedWordKeys.size, lesson.id, onUpdateReadingHistory, stopKaraoke, wordCount]
  );

  const handleToggleSpeech = () => {
    if (isSpeaking) {
      stopKaraoke();
      return;
    }
    if (allSentences.length === 0) return;
    const sessionId = ++playbackSessionRef.current;
    speakSentenceAt(0, currentRate, sessionId);
  };

  const handleChangeSpeed = (nextRate: 0.75 | 1) => {
    onUpdatePreferences({
      ...preferences,
      speechRate: nextRate,
    });
    if (isSpeaking && activeSentenceIdx !== null) {
      const sessionId = ++playbackSessionRef.current;
      speakSentenceAt(activeSentenceIdx, nextRate, sessionId);
    }
  };

  const triggerWordFromElement = useCallback(
    (el: HTMLElement, coreWord: string, paragraphText: string) => {
      if (isSpeaking) {
        stopKaraoke();
      }
      const rect = el.getBoundingClientRect();

      const normalized = normalizeArabicWord(coreWord);
      const nextInteracted = new Set(interactedWordKeys);
      nextInteracted.add(normalized);
      setInteractedWordKeys(nextInteracted);

      // Calculate reading progress percent based on word interactions & audio
      const rawRatio =
        (nextInteracted.size + (hasListenedAudio ? wordCount * 0.4 : 0)) / Math.max(1, wordCount);
      const progressPercent = Math.min(100, Math.max(15, Math.round(rawRatio * 100)));

      onUpdateReadingHistory?.({
        lessonId: lesson.id,
        titleEn: lesson.titleEn,
        titleAr: lesson.titleAr,
        level: lesson.level,
        lastReadAt: Date.now(),
        progressPercent,
        wordsInteracted: nextInteracted.size,
        totalWords: wordCount,
        audioListened: hasListenedAudio,
      });

      const sentences = paragraphText.split(/(?<=[.؟!؛])\s+/);
      const matchingSentence =
        sentences.find((s) => s.includes(coreWord)) ?? paragraphText.slice(0, 220);

      onSelectWord({
        word: coreWord,
        contextSentence: matchingSentence,
        anchorRect: {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          width: rect.width,
        },
      });
    },
    [
      hasListenedAudio,
      interactedWordKeys,
      isSpeaking,
      lesson.id,
      lesson.level,
      lesson.titleAr,
      lesson.titleEn,
      onSelectWord,
      onUpdateReadingHistory,
      stopKaraoke,
      wordCount,
    ]
  );

  const handleWordTrigger = (
    e: MouseEvent<HTMLButtonElement>,
    coreWord: string,
    paragraphText: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    triggerWordFromElement(e.currentTarget, coreWord, paragraphText);
  };

  const clearWordLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleWordTouchStart = (
    e: TouchEvent<HTMLButtonElement>,
    coreWord: string,
    paragraphText: string
  ) => {
    const touch = e.touches[0];
    if (!touch) return;
    const targetEl = e.currentTarget;
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    clearWordLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      suppressNextClickRef.current = true;
      triggerWordFromElement(targetEl, coreWord, paragraphText);
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 400);
    }, 420);
  };

  const handleWordTouchMove = (e: TouchEvent<HTMLButtonElement>) => {
    const start = touchStartPosRef.current;
    const touch = e.touches[0];
    if (!start || !touch) return;
    if (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) {
      clearWordLongPressTimer();
      touchStartPosRef.current = null;
    }
  };

  const handleWordTouchEnd = () => {
    clearWordLongPressTimer();
    touchStartPosRef.current = null;
  };

  const handleGenerateQuiz = async () => {
    setQuizLoading(true);
    setQuizError(null);
    setSelectedAnswers({});
    try {
      const response = await fetch('/api/lesson/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lessonId: lesson.id,
          titleEn: lesson.titleEn,
          textAr: lesson.textAr,
          level: lesson.level,
        }),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data?.questions)) {
        throw new Error(data?.error || 'Could not generate comprehension quiz.');
      }
      const typed = data as LessonQuizResponse;
      setQuizQuestions(typed.questions);
      setQuizSource(typed.source);
    } catch (err) {
      setQuizError(
        err instanceof Error ? err.message : 'Unable to generate comprehension quiz.'
      );
    } finally {
      setQuizLoading(false);
    }
  };

  const handleSelectQuizAnswer = (questionId: string, optionIdx: number) => {
    const updatedAnswers = { ...selectedAnswers, [questionId]: optionIdx };
    setSelectedAnswers(updatedAnswers);

    if (quizQuestions) {
      const answered = quizQuestions.filter((q) => updatedAnswers[q.id] !== undefined).length;
      if (answered === quizQuestions.length) {
        const correct = quizQuestions.filter((q) => updatedAnswers[q.id] === q.correctIndex).length;
        onUpdateReadingHistory?.({
          lessonId: lesson.id,
          lastReadAt: Date.now(),
          progressPercent: 100,
          quizCompleted: true,
          quizScore: { correct, total: quizQuestions.length },
          wordsInteracted: Math.max(interactedWordKeys.size, Math.round(wordCount * 0.6)),
          totalWords: wordCount,
        });
      }
    }
  };

  const arabicFontClass = getArabicFontClass(preferences.fontStyle);

  const answeredCount = quizQuestions
    ? quizQuestions.filter((q) => selectedAnswers[q.id] !== undefined).length
    : 0;
  const correctCount = quizQuestions
    ? quizQuestions.filter((q) => selectedAnswers[q.id] === q.correctIndex).length
    : 0;
  const quizCompleted = Boolean(quizQuestions && answeredCount === quizQuestions.length);

  return (
    <div className="space-y-6">
      {/* Top breadcrumb & unboxed metadata */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#4C1D95] hover:text-[#E11D48] transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to {levelMeta.en} Lessons</span>
        </button>

        <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono tabular-nums">
          <span className="font-semibold text-zinc-700">
            {levelMeta.en} ({levelMeta.ar})
          </span>
          <span aria-hidden="true">·</span>
          <span>{wordCount} words</span>
          <span aria-hidden="true">·</span>
          <span>{lesson.readingTimeMinutes} min read</span>
        </div>
      </div>

      {/* Main Reading Card in Royal Plum & Warm Peach */}
      <article className="rounded-2xl border border-[#ECE8EF] bg-white shadow-2xs overflow-hidden">
        {/* Lesson Title Banner — Single clean horizontal title when Arabic/English match, or clean paired layout when distinct */}
        <div className="border-b border-[#ECE8EF] bg-gradient-to-br from-white via-[#FDFBFC] to-rose-50/40 px-4 py-5 sm:px-10 sm:py-8">
          {(() => {
            const cleanEn = stripTashkeel(lesson.titleEn || '').trim();
            const cleanAr = stripTashkeel(lesson.titleAr || '').trim();
            const hasDistinctDualTitles = Boolean(cleanEn && cleanAr && cleanEn !== cleanAr);
            const displayArTitle = preferences.showTashkeel
              ? applySmartPartialTashkeel(lesson.titleAr || lesson.titleEn)
              : stripTashkeel(lesson.titleAr || lesson.titleEn);
            const singleTitleIsArabic = /[\u0600-\u06FF]/.test(lesson.titleAr || lesson.titleEn);

            if (!hasDistinctDualTitles) {
              return (
                <div className="space-y-2">
                  <h1
                    dir={singleTitleIsArabic ? 'rtl' : 'ltr'}
                    lang={singleTitleIsArabic ? 'ar' : 'en'}
                    className={
                      singleTitleIsArabic
                        ? `${arabicFontClass} text-3xl sm:text-4xl font-bold text-[#4C1D95] leading-[1.7] text-right`
                        : 'font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#241734] [text-wrap:balance]'
                    }
                  >
                    {singleTitleIsArabic ? displayArTitle : lesson.titleEn || lesson.titleAr}
                  </h1>
                  <p className="text-sm text-zinc-600 leading-relaxed max-w-3xl">
                    {lesson.description}
                  </p>
                </div>
              );
            }

            return (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2 min-w-0 flex-1">
                  <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#241734] [text-wrap:balance]">
                    {lesson.titleEn}
                  </h1>
                  <p className="text-sm text-zinc-600 leading-relaxed">{lesson.description}</p>
                </div>
                <div dir="rtl" lang="ar" className="sm:text-right min-w-0">
                  <h2 className={`${arabicFontClass} text-2xl sm:text-3xl font-bold text-[#4C1D95] leading-[1.7]`}>
                    {displayArTitle}
                  </h2>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Media & Reader Controls Toolbar */}
        <div className="border-b border-[#ECE8EF] bg-[#F7F4F9] px-4 py-3 sm:px-10 sm:py-3.5 flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {wordCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    isSpeaking
                      ? 'bg-[#E11D48] text-white shadow-xs ring-4 ring-rose-200'
                      : 'border border-[#ECE8EF] bg-white text-[#241734] hover:bg-rose-50/70 hover:border-rose-300'
                  }`}
                >
                  {isSpeaking ? (
                    <>
                      <Volume2 className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                      <span>Playing · Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
                      <span>Listen &amp; Follow · استمع وتابع</span>
                    </>
                  )}
                </button>

                {isSpeaking && (
                  <button
                    type="button"
                    onClick={stopKaraoke}
                    aria-label="Stop audio"
                    className="inline-flex items-center gap-1 rounded-xl border border-[#ECE8EF] bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:text-[#241734] transition-colors cursor-pointer"
                  >
                    <Square className="h-3 w-3" aria-hidden="true" />
                    <span>Stop</span>
                  </button>
                )}

                {/* Speed Control Toggle (0.75x / 1x) */}
                <div
                  role="group"
                  aria-label="Audio playback speed"
                  className="inline-flex items-center rounded-xl border border-[#ECE8EF] bg-white p-0.5"
                >
                  <span className="inline-flex items-center gap-1 px-2 text-[11px] font-medium text-zinc-500">
                    <Gauge className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
                  </span>
                  <button
                    type="button"
                    onClick={() => handleChangeSpeed(0.75)}
                    aria-pressed={currentRate === 0.75}
                    className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                      currentRate === 0.75
                        ? 'bg-[#4C1D95] text-white'
                        : 'text-zinc-600 hover:text-[#241734]'
                    }`}
                  >
                    0.75x
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeSpeed(1)}
                    aria-pressed={currentRate === 1}
                    className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                      currentRate === 1
                        ? 'bg-[#4C1D95] text-white'
                        : 'text-zinc-600 hover:text-[#241734]'
                    }`}
                  >
                    1x
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onUpdatePreferences({
                  ...preferences,
                  showTashkeel: !preferences.showTashkeel,
                })
              }
              className={`rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                preferences.showTashkeel
                  ? 'border-rose-300 bg-rose-50 text-rose-900'
                  : 'border-[#ECE8EF] bg-white text-zinc-600 hover:text-[#241734]'
              }`}
            >
              {preferences.showTashkeel ? 'Smart Tashkeel: On' : 'Tashkeel: Off'}
            </button>

            <div
              role="group"
              aria-label="Arabic textbook font family"
              className="inline-flex rounded-xl border border-[#ECE8EF] bg-white p-0.5"
            >
              <button
                type="button"
                onClick={() => onUpdatePreferences({ ...preferences, fontStyle: 'scheherazade' })}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  preferences.fontStyle === 'scheherazade' || (preferences.fontStyle as string) === 'cairo'
                    ? 'bg-[#4C1D95] text-white'
                    : 'text-zinc-600 hover:text-[#241734]'
                }`}
              >
                Scheherazade New
              </button>
              <button
                type="button"
                onClick={() => onUpdatePreferences({ ...preferences, fontStyle: 'amiri' })}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  preferences.fontStyle === 'amiri'
                    ? 'bg-[#4C1D95] text-white'
                    : 'text-zinc-600 hover:text-[#241734]'
                }`}
              >
                Amiri
              </button>
              <button
                type="button"
                onClick={() => onUpdatePreferences({ ...preferences, fontStyle: 'naskh' })}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  preferences.fontStyle === 'naskh'
                    ? 'bg-[#4C1D95] text-white'
                    : 'text-zinc-600 hover:text-[#241734]'
                }`}
              >
                Noto Naskh
              </button>
            </div>

            <div className="inline-flex items-center gap-1 rounded-xl border border-[#ECE8EF] bg-white px-2 py-1">
              <button
                type="button"
                onClick={() =>
                  onUpdatePreferences({
                    ...preferences,
                    fontSize: Math.max(24, preferences.fontSize - 2),
                  })
                }
                aria-label="Decrease Arabic font size"
                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold text-zinc-600 hover:bg-purple-50 hover:text-[#241734] cursor-pointer"
              >
                <span>A</span>
                <Minus className="h-3 w-3" aria-hidden="true" />
              </button>
              <span className="font-mono text-xs tabular-nums text-[#241734] px-1.5">
                {preferences.fontSize}px
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdatePreferences({
                    ...preferences,
                    fontSize: Math.min(46, preferences.fontSize + 2),
                  })
                }
                aria-label="Increase Arabic font size"
                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold text-zinc-600 hover:bg-purple-50 hover:text-[#241734] cursor-pointer"
              >
                <span>A</span>
                <Plus className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>

            {hasVideoUrl && (
              <button
                type="button"
                onClick={() => setShowVideo((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#ECE8EF] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#241734] hover:bg-rose-50/70 transition-colors cursor-pointer"
              >
                <Video className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
                <span>{showVideo ? 'Hide Video' : 'Show Video'}</span>
              </button>
            )}

            {onOpenNotes && (
              <button
                type="button"
                onClick={() =>
                  onOpenNotes({
                    type: 'lesson',
                    label: lesson.titleAr || lesson.titleEn,
                    refId: lesson.id,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#4C1D95] hover:bg-purple-50 transition-colors cursor-pointer"
              >
                <NotebookPen className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
                <span>ملاحظاتي · Notes</span>
                {notesCount > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-[#E11D48]">
                    ({notesCount})
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Synchronized YouTube Video Player (completely hidden for text-only lessons) */}
        {hasVideoUrl && showVideo && lesson.youtubeUrl && (
          <YouTubePlayer
            youtubeUrl={lesson.youtubeUrl}
            title={lesson.titleEn || lesson.titleAr}
            fallbackDurationSeconds={lesson.videoDurationSeconds || 240}
            seekRequest={seekRequest}
            autoScroll={autoScrollSync}
            onToggleAutoScroll={() => setAutoScrollSync((prev) => !prev)}
            onTimeSync={handleVideoTimeSync}
          />
        )}

        {/* Interactive LingQ-Style Arabic Reading Canvas with Karaoke Highlighting */}
        <div className="px-4 py-6 sm:px-12 sm:py-10">
          {parsedParagraphs.length === 0 ? (
            <div className="rounded-xl border border-[#ECE8EF] bg-[#F7F4F9] px-6 py-10 text-center text-sm text-zinc-600">
              {hasVideoUrl
                ? 'This video lesson has no transcript attached. Watch the YouTube lesson above to practice listening comprehension.'
                : 'This reading lesson currently has no Arabic text content.'}
            </div>
          ) : (
            <>
              <div className="mb-6 sm:mb-7 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span>
                    Tap, click, or hold any Arabic word for instant translation, partial tashkeel, and flashcards.
                  </span>
                  {hasVideoUrl && effectiveSegments.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-[#F7F4F9] px-2.5 py-1 text-[11px] font-semibold text-[#4C1D95]">
                      <Radio
                        className={`h-3 w-3 ${
                          isVideoSyncActive && videoSync.isPlaying
                            ? 'text-[#E11D48] animate-pulse'
                            : 'text-[#4C1D95]'
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        {isVideoSyncActive
                          ? `Synced at ${formatTimestamp(videoSync.currentTime)}`
                          : 'Click any timestamp to jump'}
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[#E11D48] font-medium">Coral: Reviewing</span>
                  <span className="text-[#4C1D95] font-medium">Plum: Learned</span>
                </div>
              </div>

              <div
                dir="rtl"
                lang="ar"
                className={`${arabicFontClass} text-[#241734] space-y-6`}
                style={{
                  fontSize: `${preferences.fontSize}px`,
                  lineHeight: 2.25,
                }}
              >
                {parsedParagraphs.map((paragraph) => {
                  const segment = effectiveSegments[paragraph.paragraphIndex];
                  const isActiveVideoSegment =
                    isVideoSyncActive && activeVideoSegmentIdx === paragraph.paragraphIndex;

                  let runningWordCursor = 0;

                  return (
                    <div
                      key={paragraph.paragraphIndex}
                      ref={(el) => {
                        segmentRefs.current[paragraph.paragraphIndex] = el;
                      }}
                      className={`rounded-2xl transition-all duration-200 ${
                        segment
                          ? isActiveVideoSegment
                            ? 'border-r-4 border-[#E11D48] bg-gradient-to-l from-rose-50/85 via-[#FDFBFC] to-purple-50/40 px-4 py-3.5 shadow-2xs ring-1 ring-rose-200/80'
                            : 'border-r-2 border-[#ECE8EF] px-4 py-2 hover:border-purple-300 hover:bg-[#FDFBFC]'
                          : ''
                      }`}
                    >
                      {segment && (
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-sans">
                          <button
                            type="button"
                            onClick={() => handleJumpToSegment(segment.startSec)}
                            dir="ltr"
                            title={`Jump video to ${formatTimestamp(segment.startSec)}`}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums transition-colors cursor-pointer ${
                              isActiveVideoSegment
                                ? 'bg-[#E11D48] text-white shadow-2xs'
                                : 'border border-[#ECE8EF] bg-[#F7F4F9] text-[#4C1D95] hover:border-rose-300 hover:bg-rose-50 hover:text-[#E11D48]'
                            }`}
                          >
                            <Play className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>
                              {formatTimestamp(segment.startSec)} – {formatTimestamp(segment.endSec)}
                            </span>
                          </button>
                          {isActiveVideoSegment && (
                            <span className="text-[11px] font-semibold text-[#E11D48]">
                              {videoSync.isPlaying ? 'يُعرَض الآن · Syncing' : 'المقطع الحالي'}
                            </span>
                          )}
                        </div>
                      )}

                      <p className="text-right">
                        {paragraph.sentences.map((sentence, sIdx) => {
                          const isActiveSentence =
                            isSpeaking && activeSentenceIdx === sentence.sentenceIndex;

                          return (
                            <span
                              key={sentence.sentenceIndex}
                              className={`transition-colors duration-200 rounded-xl ${
                                isActiveSentence
                                  ? 'bg-rose-50/75 ring-1 ring-rose-300/80 px-2 py-0.5'
                                  : ''
                              }`}
                            >
                              {sentence.tokens.map((token) => {
                                if (token.isWhitespace || !token.isArabicWord) {
                                  return <span key={token.id}>{token.raw}</span>;
                                }

                                const currentWordOrder = runningWordCursor;
                                runningWordCursor += 1;

                                const displayWord = preferences.showTashkeel
                                  ? applySmartPartialTashkeel(token.core)
                                  : stripTashkeel(token.core);
                                const normalizedKey = normalizeArabicWord(token.core);
                                const status = vocabStatusMap.get(normalizedKey);
                                const isWordSelected = activeWordKey === normalizedKey;
                                const isKaraokeWord =
                                  isActiveSentence &&
                                  activeWordIdx !== null &&
                                  token.spokenWordIndex === activeWordIdx;

                                const isVideoActiveWord =
                                  isActiveVideoSegment &&
                                  activeVideoWordTarget !== null &&
                                  activeVideoWordTarget.sentenceIndex === sentence.sentenceIndex &&
                                  activeVideoWordTarget.wordIndex === token.spokenWordIndex;

                                const isVideoSpokenWord =
                                  isActiveVideoSegment &&
                                  activeVideoWordTarget !== null &&
                                  currentWordOrder < activeVideoWordTarget.flatWordOrder;

                                let wordHighlightClass =
                                  'hover:bg-rose-50/90 hover:text-[#E11D48]';
                                if (isKaraokeWord || isVideoActiveWord) {
                                  wordHighlightClass =
                                    'bg-[#E11D48] text-white shadow-sm ring-2 ring-rose-300 scale-[1.03]';
                                } else if (isWordSelected) {
                                  wordHighlightClass =
                                    'bg-rose-100 text-[#4C1D95] ring-2 ring-[#E11D48]/45';
                                } else if (isVideoSpokenWord) {
                                  wordHighlightClass =
                                    'bg-purple-100/70 text-[#4C1D95] hover:bg-rose-50/90 hover:text-[#E11D48]';
                                } else if (status === 'learned') {
                                  wordHighlightClass =
                                    'bg-purple-50/90 text-[#4C1D95] underline decoration-[#4C1D95]/50 decoration-dotted underline-offset-[10px] hover:bg-purple-100/80';
                                } else if (status === 'needs_review') {
                                  wordHighlightClass =
                                    'bg-rose-50/90 text-[#BE123C] underline decoration-[#F43F5E]/65 decoration-dotted underline-offset-[10px] hover:bg-rose-100/90';
                                }

                                return (
                                  <span key={token.id}>
                                    {token.leading}
                                    <button
                                      type="button"
                                      data-arabic-word="true"
                                      onClick={(e) =>
                                        handleWordTrigger(e, token.core, paragraph.rawText)
                                      }
                                      onContextMenu={(e) =>
                                        handleWordTrigger(e, token.core, paragraph.rawText)
                                      }
                                      onTouchStart={(e) =>
                                        handleWordTouchStart(e, token.core, paragraph.rawText)
                                      }
                                      onTouchMove={handleWordTouchMove}
                                      onTouchEnd={handleWordTouchEnd}
                                      onTouchCancel={handleWordTouchEnd}
                                      className={`touch-word-btn inline rounded-lg px-1.5 py-0.5 transition-all duration-150 cursor-pointer active:scale-95 active:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48] ${wordHighlightClass}`}
                                    >
                                      {displayWord}
                                    </button>
                                    {token.trailing}
                                  </span>
                                );
                              })}
                              {sIdx < paragraph.sentences.length - 1 ? ' ' : ''}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* AI Comprehension Quiz (اختبر فهمك) Section */}
        {wordCount > 0 && (
          <div className="border-t border-[#ECE8EF] bg-gradient-to-br from-[#F7F4F9] via-white to-rose-50/35 px-4 py-6 sm:px-12 sm:py-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <ClipboardCheck className="h-5 w-5 text-[#E11D48]" aria-hidden="true" />
                  <h2 className="font-display text-xl font-bold text-[#241734]">
                    Reading Comprehension Check
                  </h2>
                  <span
                    dir="rtl"
                    lang="ar"
                    className="font-arabic-scheherazade text-2xl font-bold text-[#4C1D95]"
                  >
                    اختبارُ الفهمِ
                  </span>
                </div>
                <p className="text-xs text-zinc-600">
                  Test your understanding of this passage with 3 targeted multiple-choice questions.
                </p>
              </div>

              {!quizQuestions && (
                <button
                  type="button"
                  onClick={handleGenerateQuiz}
                  disabled={quizLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#E11D48] px-5 py-3 text-sm font-semibold text-white hover:bg-[#BE123C] disabled:opacity-60 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4 text-rose-200" aria-hidden="true" />
                  <span>
                    {quizLoading
                      ? 'Generating 3 Questions...'
                      : 'اختبر فهمك (Test Your Understanding)'}
                  </span>
                </button>
              )}
            </div>

            {quizError && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 flex items-center justify-between gap-3">
                <span>{quizError}</span>
                <button
                  type="button"
                  onClick={handleGenerateQuiz}
                  className="font-semibold text-rose-900 underline cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {quizLoading && (
              <div className="mt-6 space-y-4" aria-busy="true" aria-label="Generating comprehension quiz">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-[#ECE8EF] bg-white p-5 space-y-3"
                  >
                    <div className="h-4 w-2/3 rounded bg-purple-100/70 animate-pulse" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="h-10 rounded-xl bg-[#F7F4F9] animate-pulse" />
                      <div className="h-10 rounded-xl bg-[#F7F4F9] animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {quizQuestions && !quizLoading && (
              <div className="mt-6 space-y-5">
                {quizQuestions.map((q, qIdx) => {
                  const chosen = selectedAnswers[q.id];
                  const isAnswered = chosen !== undefined;
                  const isCorrect = chosen === q.correctIndex;

                  return (
                    <div
                      key={q.id}
                      className="rounded-2xl border border-[#ECE8EF] bg-white p-5 sm:p-6 shadow-2xs space-y-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                          <span className="font-mono font-bold text-[#E11D48]">
                            Question 0{qIdx + 1} / 0{quizQuestions.length}
                          </span>
                          {isAnswered && (
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                isCorrect ? 'text-[#4C1D95]' : 'text-[#E11D48]'
                              }`}
                            >
                              {isCorrect ? (
                                <>
                                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Correct</span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Incorrect</span>
                                </>
                              )}
                            </span>
                          )}
                        </div>

                        <p
                          dir="rtl"
                          lang="ar"
                          className={`${arabicFontClass} text-xl sm:text-2xl font-bold text-[#241734] text-right leading-[2.0]`}
                        >
                          {applySmartPartialTashkeel(q.questionAr)}
                        </p>
                        <p className="text-sm font-semibold text-zinc-800">{q.questionEn}</p>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {q.options.map((opt, optIdx) => {
                          const isSelected = chosen === optIdx;
                          const isRightOption = q.correctIndex === optIdx;

                          let btnStyle =
                            'border-[#ECE8EF] bg-[#F7F4F9] text-[#241734] hover:border-[#E11D48]/50 hover:bg-white';
                          if (isAnswered) {
                            if (isRightOption) {
                              btnStyle =
                                'border-[#4C1D95] bg-purple-50 text-[#4C1D95] font-semibold';
                            } else if (isSelected) {
                              btnStyle = 'border-rose-400 bg-rose-50 text-rose-950';
                            } else {
                              btnStyle = 'border-[#ECE8EF] bg-white text-zinc-400 opacity-75';
                            }
                          }

                          return (
                            <button
                              key={optIdx}
                              type="button"
                              disabled={isAnswered}
                              onClick={() => handleSelectQuizAnswer(q.id, optIdx)}
                              className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-xs sm:text-sm transition-colors cursor-pointer disabled:cursor-default ${btnStyle}`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <span className="font-mono text-xs font-bold opacity-70 shrink-0">
                                  {String.fromCharCode(65 + optIdx)}.
                                </span>
                                <span className="leading-snug">{opt}</span>
                              </span>
                              {isAnswered && isRightOption && (
                                <CheckCircle2
                                  className="h-4 w-4 shrink-0 text-[#4C1D95]"
                                  aria-hidden="true"
                                />
                              )}
                              {isAnswered && isSelected && !isRightOption && (
                                <XCircle
                                  className="h-4 w-4 shrink-0 text-[#E11D48]"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {isAnswered && q.explanation && (
                        <p className="rounded-xl bg-[#F7F4F9] border border-[#ECE8EF] px-3.5 py-2.5 text-xs text-zinc-700 leading-relaxed">
                          <span className="font-semibold text-[#241734]">Passage Note: </span>
                          {q.explanation}
                        </p>
                      )}
                    </div>
                  );
                })}

                {quizCompleted && (
                  <div className="rounded-2xl border border-[#ECE8EF] bg-white p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-2xs">
                    <div className="space-y-1">
                      <p className="font-display text-lg font-bold text-[#4C1D95]">
                        Score: {correctCount} / {quizQuestions.length} Correct
                      </p>
                      <p className="text-xs text-zinc-600">
                        {correctCount === quizQuestions.length
                          ? 'ممتاز! Excellent comprehension of the Arabic passage. Recorded to reading history.'
                          : 'جيد جداً! Review the highlighted passage notes above and try again anytime.'}
                        {quizSource === 'fallback' && ' (Study check generated offline)'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateQuiz}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#4C1D95] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#581C87] transition-colors shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-rose-200" aria-hidden="true" />
                      <span>New Comprehension Quiz</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    </div>
  );
}
