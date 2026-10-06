import { AppIcon } from '../icons';
import type { AppProps } from '../types';
import './CoxBox.css';

export default function CoxBox(_: AppProps) {
  return (
    <div className="coxbox-placeholder">
      <AppIcon kind="coxbox" size={72} />
      <h1>Cox Box</h1>
      <p>A new version is on the way.</p>
    </div>
  );
}
