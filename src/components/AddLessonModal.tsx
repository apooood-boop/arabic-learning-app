import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertCircle,
  BookOpenText,
  Camera,
  Captions,
  CheckCircle2,
  Loader2,
  Video,
  X,
} from 'lucide-react';
import {
  AuthUser,
  Lesson,
  LessonContentType,
  ProficiencyLevel,
  TranscriptSegment,
} from '../types/arabic';
import {
  applySmartPartialTashkeel,
  countArabicWords,
  extractYouTubeVideoId,
  parsePastedTranscriptSegments,
} from '../utils/arabic';
import {
  extractArabicTextFromImageClient,
  fetchYouTubeOEmbedClient,
  processLessonClient,
} from '../utils/geminiClient';

interface AddLessonModalProps {
  isOpen: boolean;
  defaultLevel?: ProficiencyLevel;
  currentUser: AuthUser | null;
  onClose: () => void;
  onAddLesson: (lesson: Lesson) => void;
  onOpenAuth: () => void;
}

const ARABIC_CHAR_TEST = /[\u0600-\u06FF]/;

export function AddLessonModal({
  isOpen,
  defaultLevel,
  currentUser,
  onClose,
  onAddLesson,
  onOpenAuth,
}: AddLessonModalProps) {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [level, setLevel] = useState<ProficiencyLevel | ''>(defaultLevel ?? '');
  const [contentType, setContentType] = useState<LessonContentType>('text');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [textAr, setTextAr] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtractingPhoto, setIsExtractingPhoto] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [captionStatus, setCaptionStatus] = useState<'idle' | 'loading' | 'fetched' | 'blocked'>('idle');
  const [captionNotice, setCaptionNotice] = useState<string | null>(null);
  const [detectedDuration, setDetectedDuration] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const transcriptBoxRef = useRef<HTMLTextAreaElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsProcessing(false);
      setIsExtractingPhoto(false);
      setPhotoNotice(null);
      setCaptionStatus('idle');
      setCaptionNotice(null);
      setDetectedDuration(undefined);
      setLevel(defaultLevel ?? '');
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }
    }
  }, [isOpen, defaultLevel]);

  if (!isOpen || !currentUser || currentUser.isGuest) return null;

  const wordCount = countArabicWords(textAr);

  const resetFormAndClose = () => {
    setTitle('');
    setSubtitle('');
    setLevel(defaultLevel ?? '');
    setContentType('text');
    setYoutubeUrl('');
    setTextAr('');
    setIsExtractingPhoto(false);
    setPhotoNotice(null);
    setCaptionStatus('idle');
    setCaptionNotice(null);
    setDetectedDuration(undefined);
    setError(null);
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
    onClose();
  };

  const prepareImageBase64ForOcr = async (
    file: File
  ): Promise<{ base64Data: string; mimeType: string }> => {
    const readFileRaw = () =>
      new Promise<{ base64Data: string; mimeType: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const commaIdx = result.indexOf(',');
          if (commaIdx === -1) {
            reject(new Error('Could not read captured image.'));
            return;
          }
          resolve({
            base64Data: result.slice(commaIdx + 1),
            mimeType: file.type || 'image/jpeg',
          });
        };
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });

    try {
      const objectUrl = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Invalid image format.'));
          el.src = objectUrl;
        });

        const maxDim = 1600;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.height || 1) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return await readFileRaw();
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx !== -1) {
          return {
            base64Data: dataUrl.slice(commaIdx + 1),
            mimeType: 'image/jpeg',
          };
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      // Fall back to direct FileReader if canvas downscaling is unavailable
    }

    return readFileRaw();
  };

  const handleCapturePhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setPhotoNotice(null);
    setIsExtractingPhoto(true);

    try {
      const { base64Data, mimeType } = await prepareImageBase64ForOcr(file);
      const extractedArabic = await extractArabicTextFromImageClient({
        base64Data,
        mimeType,
      });

      setTextAr((prev) => {
        const existing = prev.trim();
        return existing ? `${existing}\n\n${extractedArabic}` : extractedArabic;
      });
      setPhotoNotice(
        'تم استخراج النص العربي من الصورة بنجاح — يمكنك مراجعته أو تعديله ثم حفظ الدرس.'
      );
      window.requestAnimationFrame(() => transcriptBoxRef.current?.focus());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذّر استخراج النص العربي من الصورة · Failed to extract Arabic text from image.'
      );
    } finally {
      setIsExtractingPhoto(false);
    }
  };

  const handleFetchCaptions = async () => {
    const cleanVideo = youtubeUrl.trim();
    if (!cleanVideo || !extractYouTubeVideoId(cleanVideo)) {
      setError('Please enter a valid YouTube Video URL (e.g. https://www.youtube.com/watch?v=...).');
      return;
    }

    setError(null);
    setCaptionStatus('loading');
    setCaptionNotice(null);

    try {
      const data = await fetchYouTubeOEmbedClient(cleanVideo);

      if (!title.trim() && data.suggestedTitle?.trim()) {
        setTitle(data.suggestedTitle.trim());
      }

      setCaptionStatus('blocked');
      setCaptionNotice(data.message);
      window.requestAnimationFrame(() => transcriptBoxRef.current?.focus());
    } catch {
      setCaptionStatus('blocked');
      setCaptionNotice(
        'يمكنك لصق نص الفيديو الحقيقي في الصندوق أدناه أو نشر الدرس كفيديو مباشرة.'
      );
      window.requestAnimationFrame(() => transcriptBoxRef.current?.focus());
    }
  };

  const publishFinalLesson = (params: {
    cleanTitle: string;
    cleanSubtitle: string;
    targetLevel: ProficiencyLevel;
    finalContentType: LessonContentType;
    cleanVideo: string;
    formattedTextAr: string;
    transcriptSegments?: TranscriptSegment[];
    videoDurationSeconds?: number;
    description: string;
  }) => {
    const titleHasArabic = ARABIC_CHAR_TEST.test(params.cleanTitle);
    const titleAr = titleHasArabic
      ? applySmartPartialTashkeel(params.cleanTitle)
      : params.cleanSubtitle && ARABIC_CHAR_TEST.test(params.cleanSubtitle)
        ? applySmartPartialTashkeel(params.cleanSubtitle)
        : params.cleanTitle;
    const titleEn = !titleHasArabic ? params.cleanTitle : params.cleanSubtitle || params.cleanTitle;

    const finalWordCount = countArabicWords(params.formattedTextAr);
    const authorRole = currentUser?.role ?? 'student';
    const isPrivilegedAuthor = authorRole === 'admin' || authorRole === 'moderator';

    const newLessonId =
      typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `custom-${Date.now()}`;

    const newLesson: Lesson = {
      id: newLessonId,
      titleEn,
      titleAr,
      level: params.targetLevel,
      description: params.description,
      contentType: params.finalContentType,
      youtubeUrl: params.finalContentType === 'video' ? params.cleanVideo || undefined : undefined,
      videoDurationSeconds:
        params.finalContentType === 'video' ? params.videoDurationSeconds : undefined,
      transcriptSegments:
        params.finalContentType === 'video' ? params.transcriptSegments : undefined,
      readingTimeMinutes: Math.max(1, Math.ceil((finalWordCount || 30) / 35)),
      textAr: params.formattedTextAr,
      isCustom: true,
      authorName: currentUser?.name ?? 'Guest Author',
      authorId: currentUser?.id,
      authorRole,
      isPublic: isPrivilegedAuthor,
      status: 'published',
      createdAt: Date.now(),
    };

    onAddLesson(newLesson);
    resetFormAndClose();
  };

  const handleSubmit = async (e: FormEvent, skipTranscriptIfUnavailable = false) => {
    e.preventDefault();
    if (isProcessing || captionStatus === 'loading') return;

    const cleanTitle = title.trim();
    const cleanSubtitle = subtitle.trim();
    const cleanText = textAr.trim();
    const cleanVideo = youtubeUrl.trim();

    if (!cleanTitle) {
      setError('Please enter a Text Title (عنوان النص).');
      return;
    }

    if (!level) {
      setError('Please select a proficiency level: مبتدئ (Beginner), متوسط (Intermediate), or متقدم (Advanced).');
      return;
    }

    if (contentType === 'text' && !cleanText) {
      setError('Please paste or type the Arabic reading text content.');
      return;
    }

    if (contentType === 'video' && (!cleanVideo || !extractYouTubeVideoId(cleanVideo))) {
      setError('Please enter a valid YouTube Video URL (e.g. https://www.youtube.com/watch?v=...).');
      return;
    }

    // If user explicitly chose to publish video without transcript after captions were blocked
    if (contentType === 'video' && !cleanText && skipTranscriptIfUnavailable) {
      publishFinalLesson({
        cleanTitle,
        cleanSubtitle,
        targetLevel: level,
        finalContentType: 'video',
        cleanVideo,
        formattedTextAr: '',
        transcriptSegments: [],
        videoDurationSeconds: detectedDuration,
        description: 'YouTube video lesson for listening practice.',
      });
      return;
    }

    setError(null);
    setIsProcessing(true);

    let formattedTextAr = cleanText ? applySmartPartialTashkeel(cleanText) : '';
    let transcriptSegments: TranscriptSegment[] | undefined;
    let videoDurationSeconds: number | undefined = detectedDuration;
    let generatedDescription =
      contentType === 'video'
        ? 'YouTube video lesson with synced Arabic transcript and Smart Partial Tashkeel.'
        : 'Reading passage formatted with Smart Partial Tashkeel for interactive word lookup.';

    try {
      const data = await processLessonClient({
        contentType,
        title: cleanTitle,
        level,
        textAr: cleanText,
        youtubeUrl: contentType === 'video' ? cleanVideo : undefined,
        estimatedDuration: detectedDuration,
      });

      if (typeof data.videoDurationSeconds === 'number' && data.videoDurationSeconds > 0) {
        videoDurationSeconds = data.videoDurationSeconds;
        setDetectedDuration(data.videoDurationSeconds);
      }

      // Strict No-Hallucination guard: if video has no transcript yet, guide user cleanly
      if (contentType === 'video' && data.needsManualTranscript && !cleanText) {
        setCaptionStatus('blocked');
        setCaptionNotice(
          data.message ||
            'ألصق نص الفيديو الحقيقي أدناه أو انشر الفيديو بدون نص للتدرّب على الاستماع.'
        );
        setIsProcessing(false);
        window.requestAnimationFrame(() => transcriptBoxRef.current?.focus());
        return;
      }

      if (data.formattedTextAr?.trim()) {
        formattedTextAr = applySmartPartialTashkeel(data.formattedTextAr.trim());
      }
      if (Array.isArray(data.transcriptSegments) && data.transcriptSegments.length > 0) {
        transcriptSegments = data.transcriptSegments.map((seg, idx) => ({
          id: seg.id || `seg-${idx + 1}`,
          startSec: Number(seg.startSec) || 0,
          endSec: Math.max((Number(seg.startSec) || 0) + 1, Number(seg.endSec) || 10),
          textAr: applySmartPartialTashkeel(seg.textAr),
        }));
      }
      if (data.description?.trim()) {
        generatedDescription = data.description.trim();
      }
    } catch {
      if (contentType === 'video') {
        if (!cleanText) {
          setCaptionStatus('blocked');
          setCaptionNotice(
            'تعذّر استخراج الترجمة تلقائيًا من يوتيوب. ألصق نص الفيديو الحقيقي في الصندوق أدناه.'
          );
          setIsProcessing(false);
          window.requestAnimationFrame(() => transcriptBoxRef.current?.focus());
          return;
        }
        const parsed = parsePastedTranscriptSegments(cleanText, detectedDuration || 240);
        transcriptSegments = parsed;
        formattedTextAr = parsed.map((s) => s.textAr).join('\n\n');
      } else {
        formattedTextAr = applySmartPartialTashkeel(cleanText);
      }
    } finally {
      setIsProcessing(false);
    }

    if (contentType === 'video' && cleanText && (!transcriptSegments || transcriptSegments.length === 0)) {
      const parsed = parsePastedTranscriptSegments(cleanText, videoDurationSeconds || 240);
      transcriptSegments = parsed;
      formattedTextAr = parsed.map((s) => s.textAr).join('\n\n');
    }

    publishFinalLesson({
      cleanTitle,
      cleanSubtitle,
      targetLevel: level,
      finalContentType: contentType,
      cleanVideo,
      formattedTextAr,
      transcriptSegments,
      videoDurationSeconds,
      description: generatedDescription,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#182111]/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-lesson-title"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-[#DCE5D3] bg-white shadow-2xl max-h-[92vh] overflow-y-auto animate-fade-slide-up">
        <div className="flex items-center justify-between border-b border-[#DCE5D3] bg-[#FAFBF8] px-6 py-4">
          <div>
            <div className="flex items-baseline gap-2.5">
              <h2 id="add-lesson-title" className="font-display text-xl font-bold text-[#1F2718]">
                Add New Lesson
              </h2>
              <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]">
                إضافةُ درسٍ جديدٍ
              </span>
            </div>
            <p className="text-xs text-[#5A6552] mt-0.5">
              Texts and real video transcripts are automatically formatted with Smart Partial Tashkeel before publishing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Close modal"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#5A6552] hover:bg-[#EEF2E9] hover:text-[#1F2718] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={(e) => handleSubmit(e, false)} className="p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/70 px-3.5 py-2.5 text-xs text-[#5A6552]">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Publishing as{' '}
                <span className="font-semibold text-[#1F2718]">
                  {currentUser ? currentUser.name : 'Guest Author'}
                </span>
              </span>
              {currentUser && !currentUser.isGuest && (
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                    currentUser.role === 'admin' || currentUser.role === 'moderator'
                      ? 'bg-[#2D3B22] text-[#FACC15]'
                      : 'bg-white border border-[#DCE5D3] text-[#3B4D2B]'
                  }`}
                >
                  {currentUser.role === 'admin' || currentUser.role === 'moderator'
                    ? 'Public · درس عام للجميع'
                    : 'Private · خاص بحسابك فقط'}
                </span>
              )}
            </div>
            {!currentUser && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuth();
                }}
                className="font-semibold text-[#9A6F14] hover:underline cursor-pointer"
              >
                Sign in to save under your profile
              </button>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-orange-200 bg-[#FEF2E8] px-4 py-2.5 text-xs font-medium text-[#9A3412]">
              {error}
            </div>
          )}

          {/* 1. Text Title & Optional Subtitle */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="lesson-title-main" className="block text-xs font-semibold text-[#1F2718] mb-1.5">
                Text Title (عنوان النص) *
              </label>
              <input
                id="lesson-title-main"
                type="text"
                dir="auto"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. شايُ المساءِ في القاهرةِ"
                className="w-full rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2.5 text-sm text-[#1F2718] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
              />
            </div>

            <div>
              <label htmlFor="lesson-subtitle" className="block text-xs font-semibold text-[#1F2718] mb-1.5">
                English Title / Subtitle (Optional)
              </label>
              <input
                id="lesson-subtitle"
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="e.g. Evening Tea in Cairo"
                className="w-full rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2.5 text-sm text-[#1F2718] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
              />
            </div>
          </div>

          {/* 2. Level Selector Dropdown (مبتدئ / متوسط / متقدم) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="lesson-level" className="block text-xs font-semibold text-[#1F2718] mb-1.5">
                Proficiency Level (المستوى) *
              </label>
              <select
                id="lesson-level"
                value={level}
                onChange={(e) => setLevel(e.target.value as ProficiencyLevel | '')}
                className="w-full rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2.5 text-sm text-[#1F2718] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
              >
                <option value="">-- اختر المستوى / Select Level --</option>
                <option value="beginner">مبتدئ (Beginner)</option>
                <option value="intermediate">متوسط (Intermediate)</option>
                <option value="advanced">متقدم (Advanced)</option>
              </select>
            </div>

            {/* 3. Content Type Selector */}
            <div>
              <span className="block text-xs font-semibold text-[#1F2718] mb-1.5">
                Content Type (نوع المحتوى) *
              </span>
              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/80 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setContentType('text');
                    setCaptionNotice(null);
                    setCaptionStatus('idle');
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    contentType === 'text'
                      ? 'bg-white text-[#2D3B22] shadow-2xs'
                      : 'text-[#5A6552] hover:text-[#1F2718]'
                  }`}
                >
                  <BookOpenText className="h-3.5 w-3.5 shrink-0 text-[#D4A338]" aria-hidden="true" />
                  <span className="truncate">Written Text</span>
                </button>
                <button
                  type="button"
                  onClick={() => setContentType('video')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    contentType === 'video'
                      ? 'bg-white text-[#2D3B22] shadow-2xs'
                      : 'text-[#5A6552] hover:text-[#1F2718]'
                  }`}
                >
                  <Video className="h-3.5 w-3.5 shrink-0 text-[#D4A338]" aria-hidden="true" />
                  <span className="truncate">YouTube Video</span>
                </button>
              </div>
            </div>
          </div>

          {contentType === 'video' && (
            <div className="space-y-2.5">
              <label htmlFor="lesson-youtube" className="block text-xs font-semibold text-[#1F2718]">
                YouTube Video URL *
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="lesson-youtube"
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value);
                    if (captionStatus !== 'idle') {
                      setCaptionStatus('idle');
                      setCaptionNotice(null);
                    }
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="flex-1 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2.5 text-sm text-[#1F2718] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
                />
                <button
                  type="button"
                  onClick={handleFetchCaptions}
                  disabled={captionStatus === 'loading' || !youtubeUrl.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9] px-3.5 py-2.5 text-xs font-semibold text-[#2D3B22] hover:bg-[#DCE5D3]/70 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {captionStatus === 'loading' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4A338]" aria-hidden="true" />
                      <span>Fetching Captions...</span>
                    </>
                  ) : (
                    <>
                      <Captions className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                      <span>Fetch Real Captions · جلب الترجمة</span>
                    </>
                  )}
                </button>
              </div>

              {captionStatus === 'fetched' && captionNotice && (
                <div
                  dir="rtl"
                  lang="ar"
                  className="flex items-start gap-2 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9] px-3.5 py-2.5 text-xs text-[#2D3B22]"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2D3B22]" aria-hidden="true" />
                  <span>{captionNotice}</span>
                </div>
              )}

              {captionStatus === 'blocked' && captionNotice && (
                <div className="rounded-xl border border-[#E8D7A7] bg-[#FBF3DC] px-4 py-3 space-y-2 text-xs text-[#1F2718]">
                  <div className="flex items-start gap-2" dir="rtl" lang="ar">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#9A6F14]" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="font-semibold">{captionNotice}</p>
                      <p className="text-[11px] text-[#5A6552]">
                        نصيحة: افتح الفيديو في يوتيوب واضغط على «إظهار النص / Show transcript»، ثم انسخه وألصقه في الصندوق أدناه (مع الطوابع الزمنية مثل 0:15 أو بدونها). لن يتم اختلاق أي نص تلقائي غير حقيقي.
                      </p>
                    </div>
                  </div>
                  {!textAr.trim() && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={(e) => handleSubmit(e, true)}
                        className="rounded-lg border border-[#D4A338] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#1F2718] hover:bg-[#FAFBF8] transition-colors cursor-pointer"
                      >
                        Publish Video Without Transcript · نشر الفيديو بدون نص
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4. Arabic Content / Paste Video Transcript Textarea */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label htmlFor="lesson-text-ar" className="block text-xs font-semibold text-[#1F2718]">
                {contentType === 'video'
                  ? 'Paste Video Transcript (الصق نص الفيديو الحقيقي هنا)'
                  : 'Arabic Reading Text (Smart Partial Tashkeel applied automatically) *'}
              </label>

              <div className="flex flex-wrap items-center gap-2.5">
                {contentType === 'text' && (
                  <>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleCapturePhoto}
                      className="hidden"
                      aria-label="التقاط صورة لاستخراج النص العربي"
                    />
                    <button
                      type="button"
                      disabled={isProcessing || isExtractingPhoto}
                      onClick={() => cameraInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#D4A338]/70 bg-[#FBF3DC] px-3 py-1.5 text-xs font-bold text-[#1F2718] hover:bg-[#F5E7BC] disabled:opacity-60 transition-colors cursor-pointer touch-manipulation"
                    >
                      {isExtractingPhoto ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9A6F14]" aria-hidden="true" />
                          <span className="font-arabic-cairo">جاري استخراج النص...</span>
                        </>
                      ) : (
                        <>
                          <Camera className="h-3.5 w-3.5 text-[#9A6F14]" aria-hidden="true" />
                          <span className="font-arabic-cairo">التقاط صورة</span>
                          <span aria-hidden="true" className="text-[#9A6F14]/60">·</span>
                          <span>Capture Photo</span>
                        </>
                      )}
                    </button>
                  </>
                )}

                <span className="font-mono text-xs tabular-nums text-[#5A6552]">
                  {wordCount} Arabic words
                </span>
              </div>
            </div>

            {photoNotice && (
              <div
                dir="rtl"
                lang="ar"
                className="mb-2 flex items-start gap-2 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9] px-3.5 py-2 text-xs font-medium text-[#2D3B22]"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2D3B22]" aria-hidden="true" />
                <span>{photoNotice}</span>
              </div>
            )}

            <textarea
              ref={transcriptBoxRef}
              id="lesson-text-ar"
              rows={6}
              dir="rtl"
              lang="ar"
              value={textAr}
              onChange={(e) => setTextAr(e.target.value)}
              placeholder={
                contentType === 'video'
                  ? 'الصق نص الفيديو الحقيقي المنسوخ من يوتيوب هنا (يدعم الطوابع الزمنية مثل 0:15 أو الفقرات العادية)، أو اضغط «Fetch Real Captions» أعلاه لمحاولة استخراجه تلقائيًا...'
                  : 'اكتبِ النّصَّ العربيَّ هنا أو اضغط «التقاط صورة» لتصوير نصٍّ من كتابٍ... سيتمُّ تنسيقُهُ تلقائيًّا بالتّشكيلِ الجزئيِّ الذّكيِّ.'
              }
              className={`w-full rounded-xl border bg-white px-4 py-3 font-arabic-scheherazade text-xl leading-[2.2] text-[#1F2718] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15 ${
                captionStatus === 'blocked' && !textAr.trim()
                  ? 'border-[#D4A338] ring-2 ring-[#D4A338]/30'
                  : 'border-[#DCE5D3]'
              }`}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#DCE5D3]">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing || isExtractingPhoto}
              className="rounded-xl border border-[#DCE5D3] bg-white px-4 py-2 text-sm font-medium text-[#3F4A37] hover:bg-[#EEF2E9] disabled:opacity-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isProcessing || isExtractingPhoto || captionStatus === 'loading'}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3E522D] disabled:opacity-70 transition-colors cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-[#E8B948]" aria-hidden="true" />
                  <span>
                    {contentType === 'video'
                      ? 'Syncing Real Transcript & Tashkeel...'
                      : 'Applying Smart Partial Tashkeel...'}
                  </span>
                </>
              ) : (
                <span>Publish to Level</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
