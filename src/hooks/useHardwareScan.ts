import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanResult } from '../../electron/types';
import { errorMessage, getApi } from '../api';

export interface HardwareScanState {
  result: ScanResult | null;
  loading: boolean;
  error: string | null;
  scan: () => Promise<void>;
}

/** Gọi quét WMI qua main process; tự quét một lần khi mở app. */
export function useHardwareScan(): HardwareScanState {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const scan = useCallback(async () => {
    if (running.current) return; // tránh bấm "Quét lại" chồng lên lần đang chạy
    running.current = true;
    setLoading(true);
    setError(null);
    try {
      setResult(await getApi().scanHardware());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      running.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  return { result, loading, error, scan };
}
