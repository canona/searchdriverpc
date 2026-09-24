import { useCallback, useState } from 'react';
import type { DeviceInfo, WindowsUpdateResult } from '../../electron/types';
import { errorMessage, getApi } from '../api';

export function useWindowsUpdate() {
  const [result, setResult] = useState<WindowsUpdateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await getApi().checkWindowsUpdate());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, check };
}

/**
 * Tìm thiết bị ứng với một driver trên Windows Update. DriverHardwareID của
 * Windows Update thường là dạng chung (vd "pci\ven_8086&dev_a118") nên khớp khi
 * bằng nhau hoặc Hardware ID của thiết bị bắt đầu bằng nó + "&".
 */
export function matchDevice(hardwareId: string | null, devices: DeviceInfo[]): DeviceInfo | undefined {
  if (!hardwareId) return undefined;
  const wu = hardwareId.toLowerCase();
  return devices.find((d) =>
    d.hardwareIds.some((h) => {
      const hw = h.toLowerCase();
      return hw === wu || hw.startsWith(`${wu}&`);
    }),
  );
}
