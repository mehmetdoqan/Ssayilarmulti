-- Oyuncu bazlı tamamlanma: oda, tüm oyuncular tamamlayana kadar açık kalır.
CREATE OR REPLACE FUNCTION public.sihiri_submit_result(
  p_code text, p_token text, p_answer text, p_board_state jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.sihiri_rooms;
  pl public.sihiri_players;
  v_empty integer;
  v_count integer := 0;
  v_idx integer;
  v_piece record;
  v_cell jsonb;
  v_anchor jsonb;
  v_cells jsonb;
  v_row integer;
  v_col integer;
  v_actual text;
BEGIN
  SELECT * INTO r FROM public.sihiri_rooms
  WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oda bulunamadı.'; END IF;
  IF r.status <> 'playing' THEN RAISE EXCEPTION 'Tur aktif değil.'; END IF;

  SELECT * INTO pl FROM public.sihiri_players
  WHERE room_id = r.id AND player_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oyuncu bulunamadı.'; END IF;
  IF pl.finished_at IS NOT NULL THEN RETURN public.sihiri_room_payload(r.id, p_token); END IF;

  FOR v_piece IN
    SELECT key, value FROM jsonb_each(coalesce(p_board_state->'pieces','{}'::jsonb))
  LOOP
    v_anchor := v_piece.value->'anchor';
    v_cells := v_piece.value->'cells';
    IF v_anchor IS NULL OR v_anchor = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(v_cells) <> 'array' THEN RAISE EXCEPTION 'Parça verisi geçersiz.'; END IF;
    FOR v_cell IN SELECT value FROM jsonb_array_elements(v_cells)
    LOOP
      v_row := (v_anchor->>'r')::integer + (v_cell->>0)::integer;
      v_col := (v_anchor->>'c')::integer + (v_cell->>1)::integer;
      IF v_row NOT BETWEEN 0 AND 4 OR v_col NOT BETWEEN 0 AND 4 THEN
        RAISE EXCEPTION 'Parça tahta dışına taşıyor.';
      END IF;
      v_idx := v_row * 5 + v_col;
      IF EXISTS (
        SELECT 1
        FROM jsonb_each(coalesce(p_board_state->'pieces','{}'::jsonb)) op,
             LATERAL jsonb_array_elements(coalesce(op.value->'cells','[]'::jsonb)) oc
        WHERE op.key < v_piece.key
          AND op.value->'anchor' IS NOT NULL
          AND op.value->'anchor' <> 'null'::jsonb
          AND ((op.value->'anchor'->>'r')::integer + (oc->>0)::integer) * 5
              + ((op.value->'anchor'->>'c')::integer + (oc->>1)::integer) = v_idx
      ) THEN RAISE EXCEPTION 'Parçalar çakışıyor.'; END IF;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  IF v_count <> 24 THEN RAISE EXCEPTION 'Önce 24 hücrenin tamamını doldurun.'; END IF;

  SELECT candidate INTO v_empty
  FROM generate_series(0,24) candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_each(coalesce(p_board_state->'pieces','{}'::jsonb)) pp,
         LATERAL jsonb_array_elements(coalesce(pp.value->'cells','[]'::jsonb)) cc
    WHERE pp.value->'anchor' IS NOT NULL
      AND pp.value->'anchor' <> 'null'::jsonb
      AND ((pp.value->'anchor'->>'r')::integer + (cc->>0)::integer) * 5
          + ((pp.value->'anchor'->>'c')::integer + (cc->>1)::integer) = candidate
  ) LIMIT 1;

  IF v_empty IS NULL THEN RAISE EXCEPTION 'Boş hücre bulunamadı.'; END IF;
  v_actual := CASE WHEN v_empty = 12 THEN 'center'
                   WHEN v_empty < 12 THEN (v_empty + 1)::text
                   ELSE v_empty::text END;
  IF p_answer <> v_actual THEN RAISE EXCEPTION 'Hedef sayı boş hücre değil.'; END IF;

  UPDATE public.sihiri_players
  SET submitted_answer = p_answer, board_state = p_board_state, finished_at = now()
  WHERE id = pl.id;

  IF NOT EXISTS (
    SELECT 1 FROM public.sihiri_players
    WHERE room_id = r.id AND finished_at IS NULL
  ) THEN
    UPDATE public.sihiri_rooms SET status = 'finished' WHERE id = r.id;
  END IF;

  RETURN public.sihiri_room_payload(r.id, p_token);
END;
$function$;

REVOKE ALL ON FUNCTION public.sihiri_submit_result(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sihiri_submit_result(text,text,text,jsonb) TO anon, authenticated;


-- Oda sahibi tur başlamadan önce ortak hedef sayıyı belirler.
CREATE OR REPLACE FUNCTION public.sihiri_set_challenge(
  p_code text, p_token text, p_challenge jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.sihiri_rooms;
BEGIN
  SELECT * INTO r FROM public.sihiri_rooms
  WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oda bulunamadı.'; END IF;
  IF r.host_token <> p_token THEN RAISE EXCEPTION 'Bu işlem yalnızca oda sahibine açık.'; END IF;
  IF r.status <> 'waiting' THEN RAISE EXCEPTION 'Tur başladıktan sonra hedef sayı değiştirilemez.'; END IF;
  IF coalesce((p_challenge->>'target_number')::integer, 0) NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'Hedef sayı 1 ile 24 arasında olmalı.';
  END IF;
  UPDATE public.sihiri_rooms SET challenge = p_challenge WHERE id = r.id;
  RETURN public.sihiri_room_payload(r.id, p_token);
END;
$function$;

REVOKE ALL ON FUNCTION public.sihiri_set_challenge(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sihiri_set_challenge(text,text,jsonb) TO anon, authenticated;
