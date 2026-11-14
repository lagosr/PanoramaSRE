import { useState, useRef, useEffect, useCallback } from 'react';

export const BOTTOM_PIN_THRESHOLD_PX = 32;

/**
 * Pure distance check determining whether a scroll container is pinned near its bottom edge.
 */
export function computeIsNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx: number = BOTTOM_PIN_THRESHOLD_PX
): boolean {
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}

export interface UseSmartAutoScrollOptions {
  lineCount: number;
  isActive?: boolean;
  sessionKey?: string;
}

export interface UseSmartAutoScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isPinned: boolean;
  unseenCount: number;
  handleScroll: () => void;
  pinToBottom: () => void;
}

/**
 * Manages container-local smart auto-scroll pinning:
 * - Auto-scrolls to bottom via `scrollTop` only (never `scrollIntoView`).
 * - Immediately pauses when the user scrolls upward (`> 32px` from bottom) and counts unseen lines.
 * - Resumes pinning automatically when the user scrolls back to the bottom or clicks Pin to Bottom.
 */
export function useSmartAutoScroll({
  lineCount,
  isActive = true,
  sessionKey,
}: UseSmartAutoScrollOptions): UseSmartAutoScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState<boolean>(true);
  const [unseenCount, setUnseenCount] = useState<number>(0);

  const prevLineCountRef = useRef<number>(lineCount);
  const prevSessionKeyRef = useRef<string | undefined>(sessionKey);
  const prevActiveRef = useRef<boolean>(isActive);
  const ignoreProgrammaticUntilRef = useRef<number>(0);

  const scrollContainerToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    ignoreProgrammaticUntilRef.current = Date.now() + 80;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Re-pin & snap cleanly when switching stream session or expanding from Rest -> Active
  useEffect(() => {
    const sessionChanged = prevSessionKeyRef.current !== sessionKey;
    const newlyOpened = !prevActiveRef.current && isActive;
    prevSessionKeyRef.current = sessionKey;
    prevActiveRef.current = isActive;

    if (sessionChanged || newlyOpened) {
      setIsPinned(true);
      setUnseenCount(0);
      prevLineCountRef.current = lineCount;
      if (isActive && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(scrollContainerToBottom);
      }
    }
  }, [sessionKey, isActive, lineCount, scrollContainerToBottom]);

  // Handle incoming lines
  useEffect(() => {
    const delta = lineCount - prevLineCountRef.current;
    prevLineCountRef.current = lineCount;

    if (delta < 0) {
      // Stream was cleared
      setIsPinned(true);
      setUnseenCount(0);
      return;
    }

    if (delta === 0) return;

    if (!isActive) return;

    if (isPinned) {
      setUnseenCount(0);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(scrollContainerToBottom);
      }
    } else {
      setUnseenCount((prev) => prev + delta);
    }
  }, [lineCount, isActive, isPinned, scrollContainerToBottom]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = computeIsNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
    if (nearBottom) {
      setIsPinned(true);
      setUnseenCount(0);
    } else if (Date.now() > ignoreProgrammaticUntilRef.current) {
      setIsPinned(false);
    }
  }, []);

  const pinToBottom = useCallback(() => {
    setIsPinned(true);
    setUnseenCount(0);
    scrollContainerToBottom();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scrollContainerToBottom);
    }
  }, [scrollContainerToBottom]);

  return {
    containerRef,
    isPinned,
    unseenCount,
    handleScroll,
    pinToBottom,
  };
}
