import {generateDraft} from './timetable-planner.mjs?v=29.0';
self.onmessage=e=>{try{self.postMessage({draft:generateDraft(e.data.state,e.data.options)})}catch(err){self.postMessage({error:err.message})}};
