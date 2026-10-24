import json,sys
p='docs/notes/c2_tasks.json'; t=json.load(open(p))
key,val=sys.argv[1],sys.argv[2]
t.setdefault('results',{})[key]=val
t['running'].pop(key,None)
json.dump(t,open(p,'w'),indent=1); print('logged',key)
