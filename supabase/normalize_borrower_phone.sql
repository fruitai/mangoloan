-- Run in Supabase SQL Editor or with:
-- supabase db query --linked -f supabase/normalize_borrower_phone.sql
-- Keeps borrower phone numbers in E.164-ish format for US numbers.

create or replace function public.normalize_phone_e164(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v_trimmed text;
  v_digits text;
begin
  v_trimmed := btrim(coalesce(p_phone, ''));
  if v_trimmed = '' then
    return null;
  end if;

  v_digits := regexp_replace(v_trimmed, '\D', '', 'g');
  if v_digits = '' then
    return null;
  end if;

  if left(v_trimmed, 1) = '+' then
    return '+' || v_digits;
  end if;

  if length(v_digits) = 10 then
    return '+1' || v_digits;
  end if;

  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    return '+' || v_digits;
  end if;

  return '+' || v_digits;
end;
$$;

create or replace function public.normalize_borrower_phone_before_save()
returns trigger
language plpgsql
as $$
begin
  new.phone := public.normalize_phone_e164(new.phone);
  return new;
end;
$$;

drop trigger if exists normalize_borrower_phone_before_save on public.borrowers;
create trigger normalize_borrower_phone_before_save
before insert or update of phone on public.borrowers
for each row
execute function public.normalize_borrower_phone_before_save();

update public.borrowers
set phone = public.normalize_phone_e164(phone)
where phone is not null and btrim(phone) <> '';
