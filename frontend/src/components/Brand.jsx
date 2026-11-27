import React from 'react';
import { Layers2 } from 'lucide-react';

export function Brand() {
  return <div className="flex items-center gap-3">
    <span className="brand-mark" aria-hidden="true"><Layers2 size={22} strokeWidth={2.3} /></span>
    <span className="text-[1.12rem] font-bold tracking-[-.055em]">Switchboard</span>
  </div>;
}
