'use client';

import { AlertCircle } from 'lucide-react';
import type { ErrorMessageData } from '../../lib/types';

export default function ErrorMessage({ message }: { message: ErrorMessageData }) {
  return (
    <div className="msg-container">
      <div className="msg-error">
        <AlertCircle size={16} />
        {message.content}
      </div>
    </div>
  );
}
