import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  // لا حماية — الموقع مفتوح بالكامل
  return NextResponse.next();
}

// لا يوجد matcher — يُنفّذ على كل المسارات ما عدا _next/static و _next/image
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
