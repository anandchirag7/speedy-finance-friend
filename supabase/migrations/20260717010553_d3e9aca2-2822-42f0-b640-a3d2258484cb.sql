UPDATE public.dashboards
SET layout = '[
  {"i":"nw01","type":"net-worth","x":0,"y":0,"w":12,"h":3},
  {"i":"in01","type":"income","x":0,"y":3,"w":4,"h":2},
  {"i":"ex01","type":"expenses","x":4,"y":3,"w":4,"h":2},
  {"i":"sv01","type":"savings","x":8,"y":3,"w":4,"h":2},
  {"i":"nwt1","type":"net-worth-trend","x":0,"y":5,"w":6,"h":5},
  {"i":"cf01","type":"cash-flow","x":6,"y":5,"w":6,"h":5},
  {"i":"bl01","type":"upcoming-bills","x":0,"y":10,"w":6,"h":5},
  {"i":"ts01","type":"top-spending","x":6,"y":10,"w":6,"h":5}
]'::jsonb
WHERE is_default = true AND template_key = 'personal-finance';