'use client';
export function PhaseTransition() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-brand-100 via-lilac-100 to-mint-100 animate-fade-in">
      <div className="mb-6 flex gap-3">
        {['bg-peach-400', 'bg-butter-400', 'bg-mint-400', 'bg-brand-400'].map((c, i) => (
          <span key={i} className={`h-16 w-20 rounded-xl shadow-md ${c} animate-rise`} style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
      <h2 className="px-6 text-center text-3xl font-extrabold text-ink-800 animate-rise sm:text-4xl" style={{ animationDelay: '300ms' }}>
        친구들의 그림을 감상해 봅시다!
      </h2>
      <p className="mt-3 text-lg text-ink-600 animate-rise" style={{ animationDelay: '450ms' }}>
        마음에 드는 그림을 눌러 느낌을 남겨 보세요 💬
      </p>
    </div>
  );
}
