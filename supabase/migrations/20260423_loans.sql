-- ============================================================
-- Módulo de préstamos
-- ============================================================

-- Enums
CREATE TYPE loan_status AS ENUM (
  'draft',
  'pending_review',
  'pending_shareholder_vote',
  'pending_disbursement',
  'active',
  'paid',
  'rejected_by_admin',
  'rejected_by_shareholders'
);

CREATE TYPE loan_vote_value AS ENUM ('approved', 'rejected');

-- Tabla principal de préstamos
CREATE TABLE loans (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES profiles(id),

  -- Términos del préstamo
  requested_amount           NUMERIC(15,2) NOT NULL CHECK (requested_amount > 0),
  interest_rate              NUMERIC(6,4)  NOT NULL DEFAULT 0.02,

  -- Acciones por préstamo (1 por cada 500.000 solicitados)
  loan_shares_count          INT           NOT NULL DEFAULT 0,
  loan_shares_amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  loan_shares_paid_upfront   BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Retención 4×1000
  four_per_thousand          NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- Desembolso
  disbursed_amount           NUMERIC(15,2),
  disbursed_at               TIMESTAMPTZ,

  -- Seguimiento de pagos (se actualiza cuando se aprueban recibos)
  outstanding_balance        NUMERIC(15,2) NOT NULL DEFAULT 0,
  last_interest_payment_date DATE,

  -- Estado del flujo
  status                     loan_status   NOT NULL DEFAULT 'draft',

  -- Revisión del plan de pagos por el admin
  payment_plan_months        INT,
  plan_status                TEXT CHECK (plan_status IN ('approved', 'rejected')),
  plan_rejection_reason      TEXT,

  -- Notas admin / motivo de rechazo
  admin_notes                TEXT,
  rejection_reason           TEXT,

  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Plan de pagos (informativo, editable por el accionista mientras draft)
CREATE TABLE loan_payment_plan_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id                 UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  month_number            INT  NOT NULL,
  due_date                DATE NOT NULL,
  capital_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  estimated_interest      NUMERIC(15,2) NOT NULL DEFAULT 0,
  estimated_balance_after NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, month_number)
);

-- Votos de los accionistas
CREATE TABLE loan_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id    UUID             NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  voter_id   UUID             NOT NULL REFERENCES profiles(id),
  vote       loan_vote_value  NOT NULL,
  comment    TEXT,
  voted_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, voter_id)
);

-- Agregar loan_id a receipt_items para ligar pagos a préstamos
ALTER TABLE receipt_items ADD COLUMN loan_id UUID REFERENCES loans(id);

-- Tasa de interés configurable en ajustes del sistema
INSERT INTO system_settings (key, value, updated_at)
VALUES ('loan_interest_rate', '0.02', NOW())
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_payment_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_votes ENABLE ROW LEVEL SECURITY;

-- loans: accionista ve los suyos + los que están en votación
CREATE POLICY "loans_select_own_or_voting" ON loans
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR status = 'pending_shareholder_vote'
    OR is_admin()
  );

-- loans: accionista puede insertar el suyo
CREATE POLICY "loans_insert_own" ON loans
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- loans: accionista puede actualizar el suyo solo en draft (campos de solicitud)
-- Las transiciones de estado las hacen los API routes con admin client
CREATE POLICY "loans_update_own_draft" ON loans
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'draft' AND NOT is_admin());

-- loans: admin tiene acceso total
CREATE POLICY "loans_admin_all" ON loans
  FOR ALL TO authenticated
  USING (is_admin());

-- plan items: accionista CRUD sobre plan del préstamo en draft
CREATE POLICY "plan_items_select" ON loan_payment_plan_items
  FOR SELECT TO authenticated
  USING (
    loan_id IN (SELECT id FROM loans WHERE user_id = auth.uid())
    OR loan_id IN (SELECT id FROM loans WHERE status = 'pending_shareholder_vote')
    OR is_admin()
  );

CREATE POLICY "plan_items_insert_draft" ON loan_payment_plan_items
  FOR INSERT TO authenticated
  WITH CHECK (
    loan_id IN (SELECT id FROM loans WHERE user_id = auth.uid() AND status = 'draft')
    OR is_admin()
  );

CREATE POLICY "plan_items_update_draft" ON loan_payment_plan_items
  FOR UPDATE TO authenticated
  USING (
    loan_id IN (SELECT id FROM loans WHERE user_id = auth.uid() AND status = 'draft')
    OR is_admin()
  );

CREATE POLICY "plan_items_delete_draft" ON loan_payment_plan_items
  FOR DELETE TO authenticated
  USING (
    loan_id IN (SELECT id FROM loans WHERE user_id = auth.uid() AND status = 'draft')
    OR is_admin()
  );

-- votes: todos los accionistas pueden ver y votar préstamos en votación
CREATE POLICY "votes_select_all" ON loan_votes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "votes_insert_own" ON loan_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    voter_id = auth.uid()
    AND loan_id IN (SELECT id FROM loans WHERE status = 'pending_shareholder_vote')
  );

CREATE POLICY "votes_admin_all" ON loan_votes
  FOR ALL TO authenticated
  USING (is_admin());

-- ============================================================
-- Función helper: contar accionistas activos (excluyendo admins)
-- ============================================================
CREATE OR REPLACE FUNCTION count_active_shareholders()
RETURNS BIGINT
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT COUNT(*) FROM profiles WHERE role = 'accionista';
$$;

GRANT EXECUTE ON FUNCTION count_active_shareholders TO authenticated;
