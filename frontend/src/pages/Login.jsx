import React from 'react';
import { AudioLines, MessageCircle, ShieldCheck } from 'lucide-react';
import { Brand } from '../components/Brand.jsx';

export function Login({ expired }) {
  return <main className="grid min-h-dvh bg-white lg:grid-cols-[minmax(420px,1fr)_1.04fr]">
    <section className="flex min-h-[75dvh] flex-col px-7 py-8 sm:px-14 sm:py-11 lg:px-[10%]">
      <Brand />
      <div className="mx-auto flex w-full max-w-sm grow flex-col justify-center py-16">
        <h1 className="text-[clamp(2.45rem,5vw,3.65rem)] leading-[1.04] font-semibold tracking-[-.075em]">Your support inbox.</h1>
        <p className="mt-5 max-w-[34ch] leading-7 text-muted">Sign in to manage customer conversations with your team.</p>
        {expired && <p role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Your session ended. Sign in to continue.</p>}
        <a href="/auth/login" className="button button-primary mt-8 min-h-12 w-full justify-center">Sign in to Switchboard</a>
        <p className="mt-5 inline-flex items-center gap-2 text-sm text-muted"><ShieldCheck size={16} aria-hidden="true" /> Sign in with your organization account</p>
      </div>
    </section>
    <div aria-hidden="true" className="login-art m-4 hidden overflow-hidden rounded-[1.8rem] lg:grid lg:place-items-center">
      <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" /><div className="login-orbit orbit-three" />
      <div className="login-graphic">
        <span className="login-symbol"><MessageCircle size={86} strokeWidth={1.35} /></span>
        <span className="login-signal"><AudioLines size={50} strokeWidth={1.55} /></span>
      </div>
    </div>
  </main>;
}
