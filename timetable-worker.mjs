import {generateDraft} from './timetable-planner.mjs?v=27.2';
self.onmessage=e=>{try{self.postMessage({draft:generateDraft(e.data.state,e.data.options)})}catch(err){self.postMessage({error:err.message})}};
