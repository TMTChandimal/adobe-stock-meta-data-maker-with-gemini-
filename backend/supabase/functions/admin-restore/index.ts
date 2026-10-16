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
    const adminSecret = req.headers.get('x-admin-secret');
    const expectedSecret = Deno.env.get('LICENSE_ADMIN_SECRET');

    if (!expectedSecret || adminSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid admin secret' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { licenseId, notes } = await req.json();

    if (!licenseId) {
      return new Response(JSON.stringify({ error: 'Missing licenseId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data, error } = await supabase
      .from('licenses')
      .update({
        status: 'active',
        notes: notes ? `Restored: ${notes}` : 'Restored by administrator',
        updated_at: new Date().toISOString()
      })
      .eq('license_id', licenseId);

    if (error) throw error;

    // Log audit event
    await supabase.from('events').insert({
      license_id: licenseId,
      event_type: 'restored',
      timestamp: new Date().toISOString(),
      metadata: JSON.stringify({ notes: notes || 'manual' })
    });

    return new Response(JSON.stringify({ success: true, message: `License ${licenseId} restored to active.` }), {
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
