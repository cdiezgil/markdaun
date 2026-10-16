import { useNavigate } from 'react-router-dom';
import type { VaultEntry } from '../store/vaultStore';

export function useFileNavigation() {
  const navigate = useNavigate();

  function navigateToFile(entry: VaultEntry) {
    if (entry.kind !== 'file') return;

    const encodedPath = encodeURIComponent(entry.path);

    switch (entry.file_type) {
      case 'md':
        navigate(`/editor/${encodedPath}`);
        break;
      case 'image':
      case 'pdf':
        navigate(`/preview/${encodedPath}`);
        break;
      default:
        // other: no action
        break;
    }
  }

  return { navigateToFile };
}
