import { Suspense } from 'react';
import { AuthForm } from '@/components/teacher/AuthForm';
export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
