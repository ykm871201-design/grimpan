export type Phase = 'drawing' | 'sharing' | 'closed';

export interface Room {
  id: string;
  teacher_id: string;
  title: string;
  code: string;
  max_students: number;
  phase: Phase;
  comments_enabled: boolean;
  allow_resubmit_in_sharing: boolean;
  moderation_rev: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Participant {
  id: string;
  room_id: string;
  user_id: string | null;
  student_number: number;
  nickname: string;
  joined_at: string;
  last_seen_at: string;
}

export interface Artwork {
  id: string;
  room_id: string;
  participant_id: string;
  image_path: string;
  thumb_path: string;
  version: number;
  is_visible: boolean;
  submitted_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  room_id: string;
  artwork_id: string;
  author_participant_id: string;
  body: string;
  is_hidden: boolean;
  created_at: string;
}

export interface RoomBasic {
  id: string;
  title: string;
  phase: Phase;
  max_students: number;
}

export const PHASE_LABEL: Record<Phase, string> = {
  drawing: '그림 그리기',
  sharing: '느낌 나누기',
  closed: '활동 마무리',
};

export const COMMENT_MAX = 100;
export const COMMENT_COOLDOWN_MS = 3000;
export const BUCKET = 'artworks';
