import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    // 1. Verify Admin Secret
    const adminSecret = req.headers.get('x-admin-secret');
    const expectedSecret = Deno.env.get('LICENSE_ADMIN_SECRET');

    if (!expectedSecret || adminSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid admin secret' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const payload = await req.json();

    if (!payload.licenseId || !payload.customerEmail || !payload.plan) {
      return new Response(JSON.stringify({ error: 'Missing required license fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Connect to Supabase as an Admin
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 3. Upsert or insert license record
    const { data, error } = await supabase
      .from('licenses')
      .upsert({
        license_id: payload.licenseId,
        license_code: payload.licenseCode,
        customer_email: payload.customerEmail,
        customer_name: payload.customerName || '',
        plan: payload.plan,
        expires_at: payload.expiresAt || null,
        activation_limit: parseInt(payload.activationLimit || '1'),
        order_reference: payload.orderReference || '',
        status: 'active',
        updated_at: new Date().toISOString()
      }, { onConflict: 'license_id' });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, licenseId: payload.licenseId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
