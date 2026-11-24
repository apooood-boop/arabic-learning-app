import { useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import {
  Bookmark,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  Pencil,
  RotateCw,
  Trash2,
  Volume2,
} from 'lucide-react';
import { PracticeStatus, SrsRating, VocabCard } from '../types/arabic';
import { enrichWordMeta, getLexiconSpeechText } from '../data/fallbackLexicon';
import { applySmartPartialTashkeel, LEVEL_LABELS, speakArabic, stopArabicSpeech, unlockArabicAudioContext } from '../utils/arabic';

interface Flashcard3DProps {
  card: VocabCard;
  speechRate?: number;
  large?: boolean;
  controlledFlipped?: boolean;
  onFlipChange?: (flipped: boolean) => void;
  onUpdateStatus?: (id: string, status: PracticeStatus) => void;
  onToggleDifficult?: (id: string) => void;
  onEdit?: (card: VocabCard) => void;
  onDelete?: (id: string) => void;
}

const SRS_META: Record<SrsRating, { label: string; colorClass: string }> = {
  hard: { label: 'Hard · Review Soon', colorClass: 'text-[#C2410C]' },
  good: { label: 'Good · 2d interval', colorClass: 'text-[#9A6F14]' },
  easy: { label: 'Easy · 7d interval', colorClass: 'text-[#2D3B22]' },
};

export function Flashcard3D({
  card,
  speechRate = 0.92,
  large = false,
  controlledFlipped,
  onFlipChange,
  onUpdateStatus,
  onToggleDifficult,
  onEdit,
  onDelete,
}: Flashcard3DProps) {
  const [internalFlipped, setInternalFlipped] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<'word' | number | null>(null);
  const [speakingPhase, setSpeakingPhase] = useState<'idle' | 'loading' | 'playing'>('idle');
  const touchStartRef = useRef<{ x: number; y: number; ignored: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);

  const isFlipped = controlledFlipped !== undefined ? controlledFlipped : internalFlipped;

  const handleToggleFlip = () => {
    const next = !isFlipped;
    if (onFlipChange) {
      onFlipChange(next);
    } else {
      setInternalFlipped(next);
    }
  };

  const handleCardTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const startedOnButton = Boolean(target?.closest('button'));
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      ignored: startedOnButton,
    };
  };

  const handleCardTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.ignored) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      suppressNextClickRef.current = true;
      handleToggleFlip();
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 350);
    }
  };

  const handleSpeak = (e: MouseEvent, text: string, key: 'word' | number) => {
    e.stopPropagation();
    unlockArabicAudioContext();
    if (speakingPhase === 'loading') {
      return;
    }
    if (speakingKey === key) {
      stopArabicSpeech();
      setSpeakingKey(null);
      setSpeakingPhase('idle');
      return;
    }
    if (key === 'word') {
      const vocalizedText = card.hasCustomEdits
        ? card.wordWithTashkeel
        : card.vocalizedWord ||
          getLexiconSpeechText(
            card.word,
            card.wordWithTashkeel,
            wordType,
            card.partOfSpeech
          );
      speakArabic(text, {
        rate: speechRate,
        mode: 'word',
        vocalizedText,
        meaningHint: card.englishMeaning,
        wordType,
        partOfSpeech: card.partOfSpeech,
        onLoading: () => {
          setSpeakingKey(key);
          setSpeakingPhase('loading');
        },
        onStart: () => {
          setSpeakingKey(key);
          setSpeakingPhase('playing');
        },
        onEnd: () => {
          setSpeakingKey((curr) => {
            if (curr === key) {
              setSpeakingPhase('idle');
              return null;
            }
            return curr;
          });
        },
        onError: () => {
          setSpeakingKey(null);
          setSpeakingPhase('idle');
        },
      });
    } else {
      speakArabic(text, {
        rate: speechRate,
        mode: 'example',
        vocalizedText: text,
        onLoading: () => {
          setSpeakingKey(key);
          setSpeakingPhase('loading');
        },
        onStart: () => {
          setSpeakingKey(key);
          setSpeakingPhase('playing');
        },
        onEnd: () => {
          setSpeakingKey((curr) => {
            if (curr === key) {
              setSpeakingPhase('idle');
              return null;
            }
            return curr;
          });
        },
        onError: () => {
          setSpeakingKey(null);
          setSpeakingPhase('idle');
        },
      });
    }
  };

  const handleStatusToggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (!onUpdateStatus) return;
    onUpdateStatus(card.id, card.status === 'learned' ? 'needs_review' : 'learned');
  };

  const handleDifficultToggle = (e: MouseEvent) => {
    e.stopPropagation();
    onToggleDifficult?.(card.id);
  };

  const handleRemove = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.(card.id);
  };

  const heightClass = large ? 'min-h-[460px]' : 'min-h-[420px]';
  const srsInfo = card.srsRating ? SRS_META[card.srsRating] : null;
  const { wordType, root } = enrichWordMeta(
    card.wordWithTashkeel,
    card.partOfSpeech,
    card.wordType,
    card.root
  );

  return (
    <div className={`perspective-1400 w-full ${heightClass} group`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          if (window.getSelection()?.toString().trim()) {
            return;
          }
          handleToggleFlip();
        }}
        onTouchStart={handleCardTouchStart}
        onTouchEnd={handleCardTouchEnd}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggleFlip();
          }
        }}
        aria-label={`Flashcard for ${card.wordWithTashkeel}. Tap, swipe, or press Enter to flip.`}
        className={`touch-card-surface relative h-full w-full ${heightClass} transform-style-3d flashcard-transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A338] rounded-2xl ${
          isFlipped ? 'rotate-y-180' : ''
        }`}
      >
        {/* FRONT SIDE: Arabic Word with Smart Partial Tashkeel + Context Sentences + Listen */}
        <div className="backface-hidden absolute inset-0 flex flex-col justify-between rounded-2xl border border-[#DCE5D3] bg-white/95 backdrop-blur-md p-5 sm:p-6 shadow-sm group-hover:shadow-md transition-shadow overflow-y-auto overscroll-contain">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE5D3]/80 pb-3 select-none">
            <div className="flex items-center gap-2.5 text-xs font-semibold">
              {card.status === 'learned' ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#EEF2E9] px-2 py-0.5 text-[#2D3B22]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#2D3B22]" aria-hidden="true" />
                  <span>Learned</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#FBF3DC] px-2 py-0.5 text-[#9A6F14]">
                  <Bookmark className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                  <span>Needs Review</span>
                </span>
              )}

              {srsInfo && (
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${srsInfo.colorClass}`}>
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>{srsInfo.label}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {onEdit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(card);
                  }}
                  aria-label={`تعديل / Edit ${card.wordWithTashkeel}`}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#5A6552] hover:border-[#2D3B22]/40 hover:bg-[#EEF2E9] hover:text-[#2D3B22] transition-colors cursor-pointer touch-manipulation"
                >
                  <Pencil className="h-3 w-3 text-[#9A6F14]" aria-hidden="true" />
                  <span className="font-arabic-cairo">تعديل</span>
                  <span aria-hidden="true" className="text-[#DCE5D3]">/</span>
                  <span>Edit</span>
                </button>
              )}

              <button
                type="button"
                onClick={(e) => handleSpeak(e, card.wordWithTashkeel, 'word')}
                aria-busy={speakingKey === 'word' && speakingPhase === 'loading'}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer touch-manipulation ${
                  speakingKey === 'word'
                    ? 'border-[#2D3B22] bg-[#2D3B22] text-[#E8B948] ring-4 ring-[#DCE5D3]'
                    : 'border-[#DCE5D3] bg-[#FBF3DC]/70 text-[#24301B] hover:bg-[#FBF3DC]'
                }`}
              >
                {speakingKey === 'word' && speakingPhase === 'loading' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 text-[#E8B948] animate-spin" aria-hidden="true" />
                    <span>Loading · انتظر</span>
                  </>
                ) : (
                  <>
                    <Volume2
                      className={`h-3.5 w-3.5 ${
                        speakingKey === 'word' ? 'text-[#E8B948] animate-pulse' : 'text-[#9A6F14]'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{speakingKey === 'word' ? 'Playing · استمع' : 'Pronounce · استمع'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div dir="rtl" lang="ar" className="py-2 text-center">
            <p
              className={`font-arabic-scheherazade font-bold text-[#1F2718] leading-[1.9] ${
                large ? 'text-5xl sm:text-6xl' : 'text-4xl sm:text-5xl'
              }`}
            >
              {card.hasCustomEdits
                ? card.wordWithTashkeel
                : applySmartPartialTashkeel(card.wordWithTashkeel)}
            </p>
            {(wordType || root) && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 font-arabic-cairo">
                {wordType && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#CDE0C4] bg-[#EEF2E9] px-3 py-1 text-xs font-bold text-[#2D3B22] shadow-2xs">
                    <span className="text-[#5A6552] font-normal">نوع الكلمة:</span>
                    <span className="font-bold">{wordType}</span>
                  </span>
                )}
                {root && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#F3E2B4] bg-[#FBF3DC] px-3 py-1 text-xs font-bold text-[#1F2718] shadow-2xs">
                    <span className="text-[#7A5B10] font-bold">الجذر:</span>
                    <span className="font-mono tracking-wider font-extrabold">{root}</span>
                  </span>
                )}
              </div>
            )}
            <p className="mt-1.5 font-mono text-xs text-[#5A6552]" dir="ltr">
              {card.transliteration}
            </p>
          </div>

          <div dir="rtl" lang="ar" className="space-y-2 border-t border-[#DCE5D3]/80 pt-3">
            {card.examples.slice(0, 3).map((ex, idx) => {
              const isPlayingSentence = speakingKey === idx;
              return (
                <div
                  key={idx}
                  className="flex items-start justify-between gap-2 rounded-xl bg-[#FAFBF8] border border-[#DCE5D3]/80 px-3.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    {ex.contextLabel && (
                      <p
                        dir="ltr"
                        className="text-[10px] font-bold uppercase tracking-wider text-[#9A6F14] text-right mb-0.5"
                      >
                        {ex.contextLabel}
                      </p>
                    )}
                    <p className="font-arabic-scheherazade text-xl sm:text-[21px] leading-[2.15] text-[#1F2718]">
                      {card.hasCustomEdits ? ex.arabic : applySmartPartialTashkeel(ex.arabic)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleSpeak(e, ex.arabic, idx)}
                    aria-busy={isPlayingSentence && speakingPhase === 'loading'}
                    aria-label={`Listen to Arabic sentence ${idx + 1}`}
                    className={`mt-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all cursor-pointer ${
                      isPlayingSentence
                        ? 'bg-[#2D3B22] text-[#E8B948] ring-2 ring-[#DCE5D3]'
                        : 'text-[#9A6F14] hover:bg-[#FBF3DC]'
                    }`}
                  >
                    {isPlayingSentence && speakingPhase === 'loading' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Volume2
                        className={`h-3.5 w-3.5 ${isPlayingSentence ? 'animate-pulse' : ''}`}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A6552] pt-1 select-none">
            <span className="font-medium text-[#5A6552]">{card.partOfSpeech}</span>

            <span className="inline-flex items-center gap-1.5 font-semibold text-[#9A6F14]">
              <RotateCw className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
              <span>Tap to flip</span>
            </span>
          </div>
        </div>

        {/* BACK SIDE: English meaning + Example sentences with English translation underneath + SRS Controls */}
        <div
          dir="ltr"
          className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col justify-between rounded-2xl border border-[#D4A338]/45 bg-gradient-to-br from-white via-[#FAFBF8] to-[#EEF2E9]/70 p-5 sm:p-6 shadow-sm overflow-y-auto overscroll-contain"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE5D3]/80 pb-3 select-none">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#5A6552]">
              <span className="font-semibold text-[#1F2718]">{card.partOfSpeech}</span>
              {card.transliteration && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[#5A6552] select-text">{card.transliteration}</span>
                </>
              )}
              {card.level && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-[#9A6F14]">
                    {LEVEL_LABELS[card.level].en}
                  </span>
                </>
              )}
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2D3B22]">
              <RotateCw className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
              <span>Arabic front</span>
            </span>
          </div>

          <div className="py-2 space-y-1">
            <p className="text-xs font-semibold text-[#5A6552]">English Meaning</p>
            <h3
              className={`font-display font-bold text-[#1F2718] ${
                large ? 'text-2xl' : 'text-xl'
              }`}
            >
              {card.englishMeaning}
            </h3>
          </div>

          {card.examples.length > 0 && (
            <div className="space-y-2.5 border-t border-[#DCE5D3]/80 pt-3">
              <p className="text-xs font-semibold text-[#5A6552]">Example Sentences</p>
              {card.examples.slice(0, 2).map((ex, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2.5 text-sm leading-relaxed text-[#1F2718] space-y-1 shadow-2xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#9A6F14]">
                      Example {idx + 1}
                    </span>
                    {ex.contextLabel && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#2D3B22]">
                        {ex.contextLabel}
                      </span>
                    )}
                  </div>
                  <p className="font-arabic-scheherazade text-lg sm:text-[19px] leading-[2.0] text-[#1F2718] text-right" dir="rtl" lang="ar">
                    {card.hasCustomEdits ? ex.arabic : applySmartPartialTashkeel(ex.arabic)}
                  </p>
                  <p className="text-xs text-[#5A6552] font-normal leading-normal" dir="ltr">
                    {ex.english}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#DCE5D3]/80 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {onUpdateStatus ? (
                <button
                  type="button"
                  onClick={handleStatusToggle}
                  className={`inline-flex min-h-[40px] sm:min-h-0 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
                    card.status === 'learned'
                      ? 'border border-[#E8D7A7] bg-[#FBF3DC] text-[#9A6F14] hover:bg-[#F5E7BC]'
                      : 'bg-[#2D3B22] text-white hover:bg-[#3E522D]'
                  }`}
                >
                  {card.status === 'learned' ? (
                    <>
                      <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Needs Review</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
                      <span>Mark Learned</span>
                    </>
                  )}
                </button>
              ) : (
                <span className="text-xs text-[#5A6552] truncate max-w-[180px]">
                  {card.lessonTitle || 'Arabic Reading'}
                </span>
              )}

              {onToggleDifficult && (
                <button
                  type="button"
                  onClick={handleDifficultToggle}
                  aria-pressed={card.srsRating === 'hard'}
                  className={`inline-flex min-h-[40px] sm:min-h-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer touch-manipulation whitespace-nowrap ${
                    card.srsRating === 'hard'
                      ? 'border-orange-300 bg-[#FEF2E8] text-[#C2410C] hover:bg-orange-100/80'
                      : 'border-[#DCE5D3] bg-white text-[#5A6552] hover:border-orange-200 hover:bg-[#FEF2E8]/70 hover:text-[#C2410C]'
                  }`}
                >
                  <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{card.srsRating === 'hard' ? 'Marked Hard' : 'Mark Hard'}</span>
                </button>
              )}
            </div>

            {onDelete && (
              <button
                type="button"
                onClick={handleRemove}
                aria-label={`Remove ${card.wordWithTashkeel} from vocabulary`}
                className="inline-flex min-h-[40px] sm:min-h-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[#5A6552] hover:bg-[#FEF2E8] hover:text-[#C2410C] transition-colors cursor-pointer touch-manipulation"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Remove</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
