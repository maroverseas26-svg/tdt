// Cloudflare Pages front door for crm.todaytec.com.vn (Pages accepts a custom domain by
// CNAME from an outside DNS provider, which Workers can't). Everything is handed to the
// "tdt" Worker through the TDT service binding; the request URL — and so the domain the
// Worker sees for cookies and reset links — stays the custom domain.
export default {
  fetch(request, env) {
    return env.TDT.fetch(request);
  },
};
