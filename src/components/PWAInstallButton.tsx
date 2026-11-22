import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'banner';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        aria-label="Install Qalam Arabic App"
        title="Install App · تثبيت التطبيق"
        className={
          variant === 'header'
            ? 'inline-flex items-center gap-1.5 rounded-xl border border-[#E8B948]/50 bg-gradient-to-r from-[#D4A338] to-[#E8B948] px-2.5 py-1.5 text-xs font-bold text-[#1F2718] shadow-2xs hover:brightness-105 transition-all whitespace-nowrap shrink-0 cursor-pointer touch-manipulation active:scale-95'
            : 'inline-flex items-center gap-2 rounded-xl bg-[#D4A338] px-4 py-2.5 text-xs sm:text-sm font-bold text-[#1F2718] shadow-sm hover:brightness-105 transition-all whitespace-nowrap shrink-0 cursor-pointer touch-manipulation active:scale-95'
        }
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Install App</span>
        <span dir="rtl" lang="ar" className="sm:hidden font-arabic-cairo text-xs font-bold leading-none">
          تثبيت
        </span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="Install Qalam on iPhone or iPad"
          title="Add to Home Screen · أضف للشاشة الرئيسية"
          className={
            variant === 'header'
              ? 'inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-[#FAFBF8] hover:bg-white/15 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation active:scale-95'
              : 'inline-flex items-center gap-2 rounded-xl border border-[#DCE5D3] bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation active:scale-95'
          }
        >
          <Smartphone className="h-3.5 w-3.5 text-[#E8B948] shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Install App</span>
          <span dir="rtl" lang="ar" className="sm:hidden font-arabic-cairo text-xs font-bold leading-none">
            تثبيت
          </span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#182111]/60 backdrop-blur-[2px] p-0 sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowIOSGuide(false);
            }}
          >
            <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-[#DCE5D3] bg-white p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22] leading-tight">
                    تثبيت تطبيق قَلَم
                  </p>
                  <h3 id="ios-install-title" className="font-display text-lg font-bold text-[#1F2718]">
                    Install on iPhone / iPad
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close install instructions"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-[#5A6552] hover:bg-[#EEF2E9] cursor-pointer"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <ol className="space-y-3 text-sm text-[#3F4A37] leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EEF2E9] font-mono text-xs font-bold text-[#2D3B22]">
                    1
                  </span>
                  <span>
                    Tap the{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-[#1F2718]">
                      <Share className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                      Share
                    </span>{' '}
                    button in the Safari toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#FBF3DC] font-mono text-xs font-bold text-[#9A6F14]">
                    2
                  </span>
                  <span>
                    Scroll down and tap <strong className="text-[#1F2718]">Add to Home Screen</strong>.
                  </span>
                </li>
              </ol>

              <p dir="rtl" lang="ar" className="font-arabic-cairo rounded-xl bg-[#FAFBF8] border border-[#DCE5D3] px-3.5 py-2.5 text-xs text-[#3F4A37] leading-relaxed">
                اضغط على زر المشاركة في Safari ثم اختر <strong className="text-[#2D3B22]">إضافة إلى الشاشة الرئيسية</strong> لفتح قَلَم كتطبيق مستقل.
              </p>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all cursor-pointer"
              >
                Got it · حسنًا
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
