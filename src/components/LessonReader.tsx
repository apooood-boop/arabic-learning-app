import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Loader2,
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
  unlockArabicAudioContext,
} from '../utils/arabic';
import { generateLessonQuizClient } from '../utils/geminiClient';
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
  const [isLoadingSpeech, setIsLoadingSpeech] = useState(false);
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
    setIsLoadingSpeech(false);
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
        mode: 'sentence',
        vocalizedText: sentence.spokenText,
        onLoading: () => {
          if (playbackSessionRef.current !== sessionId) return;
          setIsLoadingSpeech(true);
        },
        onStart: () => {
          if (playbackSessionRef.current !== sessionId) return;
          setIsLoadingSpeech(false);
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
    unlockArabicAudioContext();
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
        lessonLevel: lesson.level,
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
    if (e.type === 'click') {
      const selected = window.getSelection()?.toString().trim();
      if (selected && selected.length > 0) {
        return;
      }
    }
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
      const typed = await generateLessonQuizClient({
        lessonId: lesson.id,
        titleEn: lesson.titleEn,
        textAr: lesson.textAr,
        level: lesson.level,
      });
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
    <div className="space-y-6 animate-fade-slide-up">
      {/* Top breadcrumb & unboxed metadata */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#2D3B22] hover:text-[#9A6F14] transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to {levelMeta.en} Lessons</span>
        </button>

        <div className="flex items-center gap-2 text-xs text-[#5A6552] font-mono tabular-nums">
          <span className="font-semibold text-[#1F2718]">
            {levelMeta.en} ({levelMeta.ar})
          </span>
          <span aria-hidden="true">·</span>
          <span>{wordCount} words</span>
          <span aria-hidden="true">·</span>
          <span>{lesson.readingTimeMinutes} min read</span>
        </div>
      </div>

      {/* Main Reading Card in Dark Olive & Warm Cream */}
      <article className="rounded-2xl border border-[#DCE5D3] bg-white shadow-2xs overflow-hidden">
        {/* Lesson Title Banner */}
        <div className="border-b border-[#DCE5D3] bg-gradient-to-br from-white via-[#FAFBF8] to-[#EEF2E9]/70 px-4 py-5 sm:px-10 sm:py-8">
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
                        ? `${arabicFontClass} text-3xl sm:text-4xl font-bold text-[#2D3B22] leading-[1.7] text-right`
                        : 'font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1F2718] [text-wrap:balance]'
                    }
                  >
                    {singleTitleIsArabic ? displayArTitle : lesson.titleEn || lesson.titleAr}
                  </h1>
                  <p className="text-sm text-[#5A6552] leading-relaxed max-w-3xl">
                    {lesson.description}
                  </p>
                </div>
              );
            }

            return (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2 min-w-0 flex-1">
                  <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1F2718] [text-wrap:balance]">
                    {lesson.titleEn}
                  </h1>
                  <p className="text-sm text-[#5A6552] leading-relaxed">{lesson.description}</p>
                </div>
                <div dir="rtl" lang="ar" className="sm:text-right min-w-0">
                  <h2 className={`${arabicFontClass} text-2xl sm:text-3xl font-bold text-[#2D3B22] leading-[1.7]`}>
                    {displayArTitle}
                  </h2>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Media & Reader Controls Toolbar */}
        <div className="border-b border-[#DCE5D3] bg-[#EEF2E9]/70 px-4 py-3 sm:px-10 sm:py-3.5 flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {wordCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    isSpeaking
                      ? 'bg-[#2D3B22] text-[#E8B948] shadow-xs ring-4 ring-[#DCE5D3]'
                      : 'border border-[#DCE5D3] bg-white text-[#1F2718] hover:bg-[#FBF3DC]/70 hover:border-[#D4A338]'
                  }`}
                >
                  {isSpeaking && isLoadingSpeech ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E8B948]" aria-hidden="true" />
                      <span>Loading Audio...</span>
                    </>
                  ) : isSpeaking ? (
                    <>
                      <Volume2 className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                      <span>Playing · Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                      <span>Listen &amp; Follow · استمع وتابع</span>
                    </>
                  )}
                </button>

                {isSpeaking && (
                  <button
                    type="button"
                    onClick={stopKaraoke}
                    aria-label="Stop audio"
                    className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white px-3 py-2 text-xs font-semibold text-[#5A6552] hover:text-[#1F2718] transition-colors cursor-pointer"
                  >
                    <Square className="h-3 w-3" aria-hidden="true" />
                    <span>Stop</span>
                  </button>
                )}

                {/* Speed Control Toggle (0.75x / 1x) */}
                <div
                  role="group"
                  aria-label="Audio playback speed"
                  className="inline-flex items-center rounded-xl border border-[#DCE5D3] bg-white p-0.5"
                >
                  <span className="inline-flex items-center gap-1 px-2 text-[11px] font-medium text-[#5A6552]">
                    <Gauge className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                  </span>
                  <button
                    type="button"
                    onClick={() => handleChangeSpeed(0.75)}
                    aria-pressed={currentRate === 0.75}
                    className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                      currentRate === 0.75
                        ? 'bg-[#2D3B22] text-white'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
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
                        ? 'bg-[#2D3B22] text-white'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
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
                  ? 'border-[#D4A338] bg-[#FBF3DC] text-[#9A6F14]'
                  : 'border-[#DCE5D3] bg-white text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              {preferences.showTashkeel ? 'Smart Tashkeel: On' : 'Tashkeel: Off'}
            </button>

            <div
              role="group"
              aria-label="Arabic textbook font family"
              className="inline-flex rounded-xl border border-[#DCE5D3] bg-white p-0.5"
            >
              <button
                type="button"
                onClick={() => onUpdatePreferences({ ...preferences, fontStyle: 'scheherazade' })}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  preferences.fontStyle === 'scheherazade' || (preferences.fontStyle as string) === 'cairo'
                    ? 'bg-[#2D3B22] text-white'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
                }`}
              >
                Scheherazade New
              </button>
              <button
                type="button"
                onClick={() => onUpdatePreferences({ ...preferences, fontStyle: 'amiri' })}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  preferences.fontStyle === 'amiri'
                    ? 'bg-[#2D3B22] text-white'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
                }`}
              >
                Amiri
              </button>
              <button
                type="button"
                onClick={() => onUpdatePreferences({ ...preferences, fontStyle: 'naskh' })}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  preferences.fontStyle === 'naskh'
                    ? 'bg-[#2D3B22] text-white'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
                }`}
              >
                Noto Naskh
              </button>
            </div>

            <div className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white px-2 py-1">
              <button
                type="button"
                onClick={() =>
                  onUpdatePreferences({
                    ...preferences,
                    fontSize: Math.max(24, preferences.fontSize - 2),
                  })
                }
                aria-label="Decrease Arabic font size"
                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold text-[#5A6552] hover:bg-[#EEF2E9] hover:text-[#1F2718] cursor-pointer"
              >
                <span>A</span>
                <Minus className="h-3 w-3" aria-hidden="true" />
              </button>
              <span className="font-mono text-xs tabular-nums text-[#1F2718] px-1.5">
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
                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold text-[#5A6552] hover:bg-[#EEF2E9] hover:text-[#1F2718] cursor-pointer"
              >
                <span>A</span>
                <Plus className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>

            {hasVideoUrl && (
              <button
                type="button"
                onClick={() => setShowVideo((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#1F2718] hover:bg-[#FBF3DC]/70 transition-colors cursor-pointer"
              >
                <Video className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
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
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#2D3B22] hover:bg-[#FBF3DC]/70 transition-colors cursor-pointer"
              >
                <NotebookPen className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                <span className="font-arabic-cairo">ملاحظاتي</span>
                <span>· Notes</span>
                {notesCount > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-[#9A6F14]">
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
            <div className="rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/70 px-6 py-10 text-center text-sm text-[#5A6552]">
              {hasVideoUrl
                ? 'This video lesson has no transcript attached. Watch the YouTube lesson above to practice listening comprehension.'
                : 'This reading lesson currently has no Arabic text content.'}
            </div>
          ) : (
            <>
              <div className="mb-6 sm:mb-7 flex flex-wrap items-center justify-between gap-3 text-xs text-[#5A6552]">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span>
                    Tap, click, or hold any Arabic word for instant translation, partial tashkeel, and flashcards.
                  </span>
                  {hasVideoUrl && effectiveSegments.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#DCE5D3] bg-[#EEF2E9] px-2.5 py-1 text-[11px] font-semibold text-[#2D3B22]">
                      <Radio
                        className={`h-3 w-3 ${
                          isVideoSyncActive && videoSync.isPlaying
                            ? 'text-[#D4A338] animate-pulse'
                            : 'text-[#2D3B22]'
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
                  <span className="inline-flex items-center gap-1.5 text-[#9A6F14] font-semibold">
                    <span className="h-2 w-2 rounded-full bg-[#D4A338]" aria-hidden="true" />
                    Amber: Reviewing
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#2D3B22] font-semibold">
                    <span className="h-2 w-2 rounded-full bg-[#2D3B22]" aria-hidden="true" />
                    Olive: Learned
                  </span>
                </div>
              </div>

              <div
                dir="rtl"
                lang="ar"
                className={`${arabicFontClass} text-[#1F2718] space-y-6`}
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
                            ? 'border-r-4 border-[#D4A338] bg-gradient-to-l from-[#FBF3DC]/75 via-[#FAFBF8] to-[#EEF2E9]/75 px-4 py-3.5 shadow-2xs ring-1 ring-[#D4A338]/40'
                            : 'border-r-2 border-[#DCE5D3] px-4 py-2 hover:border-[#3E522D]/50 hover:bg-[#FAFBF8]'
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
                                ? 'bg-[#2D3B22] text-[#E8B948] shadow-2xs'
                                : 'border border-[#DCE5D3] bg-[#EEF2E9] text-[#2D3B22] hover:border-[#D4A338] hover:bg-[#FBF3DC] hover:text-[#9A6F14]'
                            }`}
                          >
                            <Play className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>
                              {formatTimestamp(segment.startSec)} – {formatTimestamp(segment.endSec)}
                            </span>
                          </button>
                          {isActiveVideoSegment && (
                            <span className="font-arabic-cairo text-[11px] font-semibold text-[#9A6F14]">
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
                                  ? 'bg-[#FBF3DC]/80 ring-1 ring-[#D4A338]/60 px-2 py-0.5'
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
                                  'hover:bg-[#FBF3DC]/90 hover:text-[#2D3B22]';
                                if (isKaraokeWord || isVideoActiveWord) {
                                  wordHighlightClass =
                                    'bg-[#D4A338] text-[#1F2718] shadow-sm ring-2 ring-[#E8B948] scale-[1.03]';
                                } else if (isWordSelected) {
                                  wordHighlightClass =
                                    'bg-[#2D3B22] text-[#E8B948] ring-2 ring-[#D4A338]/60';
                                } else if (isVideoSpokenWord) {
                                  wordHighlightClass =
                                    'bg-[#EEF2E9] text-[#2D3B22] hover:bg-[#FBF3DC]/90 hover:text-[#9A6F14]';
                                } else if (status === 'learned') {
                                  wordHighlightClass =
                                    'bg-[#EEF2E9]/90 text-[#2D3B22] underline decoration-[#2D3B22]/50 decoration-dotted underline-offset-[10px] hover:bg-[#DCE5D3]/80';
                                } else if (status === 'needs_review') {
                                  wordHighlightClass =
                                    'bg-[#FBF3DC]/90 text-[#9A6F14] underline decoration-[#D4A338]/80 decoration-dotted underline-offset-[10px] hover:bg-[#FBF3DC]';
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
                                      className={`touch-word-btn inline rounded-lg px-1.5 py-0.5 transition-all duration-150 cursor-pointer active:scale-95 active:bg-[#FBF3DC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A338] ${wordHighlightClass}`}
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
          <div className="border-t border-[#DCE5D3] bg-gradient-to-br from-[#EEF2E9]/70 via-[#FAFBF8] to-[#FBF3DC]/40 px-4 py-6 sm:px-12 sm:py-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FBF3DC] text-[#9A6F14] border border-[#E8D7A7]/60">
                    <ClipboardCheck className="h-5 w-5 text-[#D4A338]" aria-hidden="true" />
                  </div>
                  <h2 className="font-display text-xl font-bold text-[#1F2718]">
                    Reading Comprehension Check
                  </h2>
                  <span
                    dir="rtl"
                    lang="ar"
                    className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]"
                  >
                    اختبارُ الفهمِ
                  </span>
                </div>
                <p className="text-xs text-[#5A6552]">
                  Test your understanding of this passage with 3 targeted multiple-choice questions.
                </p>
              </div>

              {!quizQuestions && (
                <button
                  type="button"
                  onClick={handleGenerateQuiz}
                  disabled={quizLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-3 text-sm font-semibold text-white hover:bg-[#3E522D] disabled:opacity-60 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                  <span>
                    {quizLoading
                      ? 'Generating 3 Questions...'
                      : 'اختبر فهمك (Test Your Understanding)'}
                  </span>
                </button>
              )}
            </div>

            {quizError && (
              <div className="mt-4 rounded-xl border border-orange-200 bg-[#FEF2E8] px-4 py-3 text-xs text-[#9A3412] flex items-center justify-between gap-3">
                <span>{quizError}</span>
                <button
                  type="button"
                  onClick={handleGenerateQuiz}
                  className="font-semibold text-[#9A3412] underline cursor-pointer"
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
                    className="rounded-2xl border border-[#DCE5D3] bg-white p-5 space-y-3"
                  >
                    <div className="h-4 w-2/3 rounded bg-[#DCE5D3] animate-pulse" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="h-10 rounded-xl bg-[#EEF2E9] animate-pulse" />
                      <div className="h-10 rounded-xl bg-[#EEF2E9] animate-pulse" />
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
                      className="rounded-2xl border border-[#DCE5D3] bg-white p-5 sm:p-6 shadow-2xs space-y-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs text-[#5A6552]">
                          <span className="font-mono font-bold text-[#9A6F14]">
                            Question 0{qIdx + 1} / 0{quizQuestions.length}
                          </span>
                          {isAnswered && (
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                isCorrect ? 'text-[#2D3B22]' : 'text-[#C2410C]'
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
                          className={`${arabicFontClass} text-xl sm:text-2xl font-bold text-[#1F2718] text-right leading-[2.0]`}
                        >
                          {applySmartPartialTashkeel(q.questionAr)}
                        </p>
                        <p className="text-sm font-semibold text-[#3F4A37]">{q.questionEn}</p>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {q.options.map((opt, optIdx) => {
                          const isSelected = chosen === optIdx;
                          const isRightOption = q.correctIndex === optIdx;

                          let btnStyle =
                            'border-[#DCE5D3] bg-[#FAFBF8] text-[#1F2718] hover:border-[#D4A338] hover:bg-white';
                          if (isAnswered) {
                            if (isRightOption) {
                              btnStyle =
                                'border-[#2D3B22] bg-[#EEF2E9] text-[#2D3B22] font-semibold';
                            } else if (isSelected) {
                              btnStyle = 'border-[#C2410C] bg-[#FEF2E8] text-[#9A3412]';
                            } else {
                              btnStyle = 'border-[#DCE5D3] bg-white text-[#6B7861] opacity-75';
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
                                  className="h-4 w-4 shrink-0 text-[#2D3B22]"
                                  aria-hidden="true"
                                />
                              )}
                              {isAnswered && isSelected && !isRightOption && (
                                <XCircle
                                  className="h-4 w-4 shrink-0 text-[#C2410C]"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {isAnswered && q.explanation && (
                        <p className="rounded-xl bg-[#FAFBF8] border border-[#DCE5D3] px-3.5 py-2.5 text-xs text-[#3F4A37] leading-relaxed">
                          <span className="font-semibold text-[#1F2718]">Passage Note: </span>
                          {q.explanation}
                        </p>
                      )}
                    </div>
                  );
                })}

                {quizCompleted && (
                  <div className="rounded-2xl border border-[#DCE5D3] bg-white p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-2xs">
                    <div className="space-y-1">
                      <p className="font-display text-lg font-bold text-[#2D3B22]">
                        Score: {correctCount} / {quizQuestions.length} Correct
                      </p>
                      <p className="text-xs text-[#5A6552]">
                        {correctCount === quizQuestions.length
                          ? 'ممتاز! Excellent comprehension of the Arabic passage. Recorded to reading history.'
                          : 'جيد جداً! Review the highlighted passage notes above and try again anytime.'}
                        {quizSource === 'fallback' && ' (Study check generated offline)'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateQuiz}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#3E522D] transition-colors shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
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
